import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { Tokens } from "marked";

import { copy } from "#/lib/copy";
import { rangesOf } from "#/lib/highlight";
import type { MarkdownDocument } from "#/lib/markdown";
import { clamp } from "#/lib/math";
import { usePrefs } from "#/lib/prefs";
import { onScrollProgress, useCurrentSection } from "#/lib/reading";
import { hasEveryWord, queryWords } from "#/lib/search";
import { getUi, useUi } from "#/lib/ui";

/**
 * Owner: minimap. The map: a 28 px strip between the document and the panel
 * that shows the whole document at once.
 *
 * - One bar per block, placed by the real geometry of the page, so a point on
 *   the strip is the same point of the scroll. Prose is a solid bar (wider
 *   when its lines are full), a table is a frame, code is its own lines.
 * - Section starts are ticks on the left. Hits (searchlight words, the echo
 *   term) are ticks on the right, in the second ink.
 * - The viewport is a window of light. The map under it is drawn a second
 *   time, lit, and the two layers move against each other by `transform`
 *   only: what the light finds, glows.
 * - It is a slider: click or drag scrubs, the keys move the page.
 *
 * The ink is SVG, and its colours are the CSS variables of the vibe
 * (`styles/minimap.css`): a change of vibe repaints it with no code here.
 */

/** The width of the strip: the middle column of `.doc-page` in `styles/tokens.css`. */
const WIDTH = 28;
/** Air above and under the map, inside the strip. */
const PAD = 8;
/** The window never gets smaller than this, however long the document is. */
const MIN_WINDOW = 14;

/** The lanes of the strip, in CSS pixels from its left edge: ticks, bars, hits. */
const TICKS_RIGHT = 6;
const PART_TICK = { width: 5, height: 2 };
const SECTION_TICK = { width: 3, height: 1 };
const BARS_LEFT = 8;
const BARS_WIDTH = 12;
const HITS_LEFT = 22;
const HITS_WIDTH = 3;

/** A table this tall on the strip is drawn as a frame; a smaller one is solid. */
const FRAME_MIN = 5;
/** A full line of prose has about this many words (72rem measure, as wide as tables). */
const WORDS_PER_LINE = 18;
/** Line height of prose in rem: `1.0625rem / 1.65` in `styles/doc.css`. */
const PROSE_LINE_REM = 1.0625 * 1.65;
/** Code lines longer than this are cut on the map. */
const CODE_COLUMNS = 72;

/** An arrow key moves the page by this share of the viewport. */
const ARROW_SHARE = 0.12;
/** PageUp and PageDown keep this share of the viewport in view. */
const PAGE_OVERLAP = 0.1;

/** No more ranges than this are measured for hits; the rest fall back to their block. */
const HIT_BUDGET = 1500;

/** The three heights the map is made of, in CSS pixels. */
export interface Geometry {
  /** Height of the strip. */
  strip: number;
  /** Height of the whole page. */
  page: number;
  /** Height of the viewport. */
  viewport: number;
}

function trackOf(geometry: Geometry): number {
  return Math.max(0, geometry.strip - PAD * 2);
}

/** Strip pixels per page pixel. */
export function scaleOf(geometry: Geometry): number {
  return geometry.page > 0 ? trackOf(geometry) / geometry.page : 0;
}

/** Height of the window on the strip. */
export function windowHeight(geometry: Geometry): number {
  const track = trackOf(geometry);
  return clamp(geometry.viewport * scaleOf(geometry), Math.min(MIN_WINDOW, track), track);
}

/** Top of the window on the strip for a scroll progress of 0..1. */
export function windowTop(geometry: Geometry, progress: number): number {
  const free = trackOf(geometry) - windowHeight(geometry);
  return PAD + clamp(progress, 0, 1) * free;
}

/**
 * Where the page must scroll so that the window sits under the pointer.
 * `y` is the pointer on the strip; `grab` is how far under the top of the
 * window the pointer holds it (half the window to centre it).
 */
export function scrubTarget(geometry: Geometry, y: number, grab: number): number {
  const free = trackOf(geometry) - windowHeight(geometry);
  const maxScroll = Math.max(0, geometry.page - geometry.viewport);
  if (free <= 0 || maxScroll <= 0) return 0;
  return (clamp(y - grab - PAD, 0, free) / free) * maxScroll;
}

/** Where a slider key takes the page from `scrollTop`. `null`: not a slider key. */
export function keyTarget(key: string, geometry: Geometry, scrollTop: number): number | null {
  const maxScroll = Math.max(0, geometry.page - geometry.viewport);
  const arrow = Math.max(40, geometry.viewport * ARROW_SHARE);
  const page = geometry.viewport * (1 - PAGE_OVERLAP);
  let target: number;
  switch (key) {
    case "ArrowDown":
    case "ArrowRight":
      target = scrollTop + arrow;
      break;
    case "ArrowUp":
    case "ArrowLeft":
      target = scrollTop - arrow;
      break;
    case "PageDown":
      target = scrollTop + page;
      break;
    case "PageUp":
      target = scrollTop - page;
      break;
    case "Home":
      target = 0;
      break;
    case "End":
      target = maxScroll;
      break;
    default:
      return null;
  }
  return clamp(target, 0, maxScroll);
}

/**
 * Index of the section a point of the strip is in: the last one that starts
 * at or above `y`. Above the first start it is the first section. -1 when
 * there is none. `starts` are in document order; a missing one is `NaN`.
 */
export function sectionAt(starts: readonly number[], y: number): number {
  let found = -1;
  let first = -1;
  for (let index = 0; index < starts.length; index++) {
    const start = starts[index];
    if (Number.isNaN(start)) continue;
    if (first === -1) first = index;
    if (start <= y) found = index;
    else break;
  }
  return found === -1 ? first : found;
}

// ── What the document gives, apart from the DOM ──────────────────────────

type Form = "tick" | "prose" | "table" | "code" | "none";

interface Part {
  form: Form;
  words: number;
  /** For code: every line as [start, end] shares of the lane. A blank line is `null`. */
  lines?: ([number, number] | null)[];
}

interface Model {
  parts: Part[];
  /** Text of every block, for the hits. */
  texts: string[];
  /** For every section: the index of the block that starts it, or -1. */
  starts: number[];
}

function codeLines(text: string): ([number, number] | null)[] {
  const lines = text.split("\n").map((line) => {
    const expanded = line.replace(/\t/g, "  ").trimEnd();
    const indent = expanded.length - expanded.trimStart().length;
    return expanded.length === indent ? null : ([indent, expanded.length] as [number, number]);
  });
  let columns = 24;
  for (const line of lines) if (line) columns = Math.max(columns, line[1]);
  columns = Math.min(columns, CODE_COLUMNS);
  return lines.map((line) => {
    if (!line) return null;
    const start = Math.min(line[0], columns * 0.6) / columns;
    return [start, Math.max(start, Math.min(1, line[1] / columns))];
  });
}

function buildModel(source: MarkdownDocument): Model {
  const sectionIds = new Set(source.sections.map((section) => section.id));
  const blockOfSection = new Map<string, number>();

  const parts = source.blocks.map((block, index): Part => {
    if (block.heading && sectionIds.has(block.heading.id)) {
      if (!blockOfSection.has(block.heading.id)) blockOfSection.set(block.heading.id, index);
      return { form: "tick", words: block.words };
    }
    if (block.kind === "table") return { form: "table", words: block.words };
    if (block.kind === "code") {
      const text = (block.token as Tokens.Code).text ?? "";
      return { form: "code", words: block.words, lines: codeLines(text) };
    }
    if (block.kind === "hr") return { form: "none", words: 0 };
    return { form: "prose", words: block.words };
  });

  return {
    parts,
    texts: source.blocks.map((block) => block.text),
    starts: source.sections.map((section) => blockOfSection.get(section.id) ?? -1),
  };
}

// ── What the page gives: measured after layout ───────────────────────────

interface Measured {
  geometry: Geometry;
  /** Device pixels per CSS pixel: the ink is snapped to it. */
  ratio: number;
  /** One line of prose, in CSS pixels. */
  line: number;
  /** Top and height of every block on the page. `NaN`: not in the DOM. */
  tops: number[];
  heights: number[];
  /** Tops of the hits on the page, in order. */
  hits: number[];
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index] && !(Number.isNaN(a[index]) && Number.isNaN(b[index]))) return false;
  }
  return true;
}

function sameMeasure(a: Measured | null, b: Measured): boolean {
  return (
    a !== null &&
    a.geometry.strip === b.geometry.strip &&
    a.geometry.page === b.geometry.page &&
    a.geometry.viewport === b.geometry.viewport &&
    a.ratio === b.ratio &&
    a.line === b.line &&
    sameNumbers(a.tops, b.tops) &&
    sameNumbers(a.heights, b.heights) &&
    sameNumbers(a.hits, b.hits)
  );
}

/** Where the lit words are on the page: one top per place, clamped to its block. */
function findHits(
  root: HTMLElement,
  model: Model,
  elements: (HTMLElement | null)[],
  tops: number[],
  heights: number[],
  scrollY: number,
): number[] {
  const { searchlight, echo } = getUi();
  // The same words the searchlight lights: `matchEntries` reads them the same way.
  const words = searchlight ? queryWords(searchlight) : [];
  if (words.length === 0 && !echo) return [];

  const hits: number[] = [];
  let budget = HIT_BUDGET;

  /** Adds the places of `ranges` inside block `index`. Returns how many it added. */
  const place = (ranges: Range[], index: number): number => {
    let added = 0;
    for (const range of ranges) {
      if (budget <= 0) break;
      budget--;
      const box = range.getBoundingClientRect();
      // A filtered row or a closed fold: the text is there, the place is not.
      if (box.width === 0 && box.height === 0) continue;
      const top = tops[index];
      hits.push(clamp(box.top + scrollY, top, top + Math.max(0, heights[index] - 1)));
      added++;
    }
    return added;
  };

  for (let index = 0; words.length > 0 && index < model.texts.length; index++) {
    const element = elements[index];
    if (!element || !hasEveryWord(model.texts[index], words)) continue;
    let added = 0;
    for (const word of words) added += place(rangesOf(element, word), index);
    // Nothing to point at inside (hidden, or out of budget): the block itself.
    if (added === 0) hits.push(tops[index]);
  }

  if (echo) {
    const indexOf = new Map<Element, number>();
    elements.forEach((element, index) => {
      if (element) indexOf.set(element, index);
    });
    for (const range of rangesOf(root, echo, { within: "code", exact: true })) {
      const host = range.startContainer.parentElement?.closest(".doc__block");
      const index = host ? indexOf.get(host) : undefined;
      if (index !== undefined) place([range], index);
    }
  }

  return hits.sort((a, b) => a - b);
}

// ── The ink: SVG paths ───────────────────────────────────────────────────

interface Ink {
  /** Path data by tone. `read` tones are the same forms in the accent. */
  prose: string;
  frame: string;
  wash: string;
  code: string;
  proseRead: string;
  frameRead: string;
  washRead: string;
  codeRead: string;
  ticks: string;
  parts: string;
  hits: string;
  /** Strip y of every section start (`NaN` when its block is not in the DOM). */
  starts: number[];
}

/** The tick of a section start: a part gets a longer, heavier one. */
function tickOf(depth: number): { width: number; height: number } {
  return depth === 1 ? PART_TICK : SECTION_TICK;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function rect(x: number, y: number, width: number, height: number): string {
  return `M${round(x)} ${round(y)}h${round(width)}v${round(height)}h${round(-width)}z`;
}

function drawInk(
  source: MarkdownDocument,
  model: Model,
  measured: Measured,
  read: ReadonlySet<string>,
): Ink {
  const { geometry, ratio, line, tops, heights } = measured;
  const scale = scaleOf(geometry);
  const snap = (value: number) => Math.round(value * ratio) / ratio;
  const toStrip = (pageY: number) => snap(PAD + pageY * scale);

  const tone = {
    prose: [] as string[],
    frame: [] as string[],
    wash: [] as string[],
    code: [] as string[],
    proseRead: [] as string[],
    frameRead: [] as string[],
    washRead: [] as string[],
    codeRead: [] as string[],
  };

  model.parts.forEach((part, index) => {
    const top = tops[index];
    const height = heights[index];
    if (Number.isNaN(top) || !(height > 0)) return;
    if (part.form === "tick" || part.form === "none") return;

    const isRead = read.has(source.blocks[index].id);
    const y = toStrip(top);
    const full = toStrip(top + height) - y;
    // One pixel of dark between neighbours, as long as the bar can spare it.
    const h = Math.max(1, full > 2 ? full - 1 : full);

    if (part.form === "table") {
      if (h >= FRAME_MIN) {
        (isRead ? tone.frameRead : tone.frame).push(
          rect(BARS_LEFT, y, BARS_WIDTH, h) + rect(BARS_LEFT + 1, y + 1, BARS_WIDTH - 2, h - 2),
        );
        (isRead ? tone.washRead : tone.wash).push(
          rect(BARS_LEFT + 1, y + 1, BARS_WIDTH - 2, h - 2),
        );
      } else {
        (isRead ? tone.frameRead : tone.frame).push(rect(BARS_LEFT, y, BARS_WIDTH, h));
      }
      return;
    }

    if (part.form === "code" && part.lines && part.lines.length > 0) {
      const into = isRead ? tone.codeRead : tone.code;
      const rows = Math.max(1, Math.floor((h + 1) / 2));
      for (let row = 0; row < rows; row++) {
        const span = part.lines[Math.floor((row * part.lines.length) / rows)];
        if (!span) continue;
        const x = BARS_LEFT + span[0] * BARS_WIDTH;
        into.push(rect(x, y + row * 2, Math.max(1.5, (span[1] - span[0]) * BARS_WIDTH), 1));
      }
      return;
    }

    // Prose: the bar is as wide as its lines are full.
    const lines = Math.max(1, height / line);
    const share = clamp(part.words / lines / WORDS_PER_LINE, 0.3, 1);
    (isRead ? tone.proseRead : tone.prose).push(
      rect(BARS_LEFT, y, Math.max(2, snap(BARS_WIDTH * share)), h),
    );
  });

  const ticks: string[] = [];
  const parts: string[] = [];
  const starts = model.starts.map((blockIndex, sectionIndex) => {
    const top = blockIndex === -1 ? Number.NaN : tops[blockIndex];
    if (Number.isNaN(top)) return Number.NaN;
    const y = toStrip(top);
    const tick = tickOf(source.sections[sectionIndex].depth);
    (tick === PART_TICK ? parts : ticks).push(
      rect(TICKS_RIGHT - tick.width, y, tick.width, tick.height),
    );
    return y;
  });

  const hits: string[] = [];
  let last = Number.NEGATIVE_INFINITY;
  for (const pageY of measured.hits) {
    const y = toStrip(pageY);
    // Hits closer than a tick is tall are one tick.
    if (y - last < 2) continue;
    last = y;
    hits.push(rect(HITS_LEFT, y, HITS_WIDTH, 2));
  }

  return {
    prose: tone.prose.join(""),
    frame: tone.frame.join(""),
    wash: tone.wash.join(""),
    code: tone.code.join(""),
    proseRead: tone.proseRead.join(""),
    frameRead: tone.frameRead.join(""),
    washRead: tone.washRead.join(""),
    codeRead: tone.codeRead.join(""),
    ticks: ticks.join(""),
    parts: parts.join(""),
    hits: hits.join(""),
    starts,
  };
}

/** One layer of the map. The lit layer has the same forms in brighter tones. */
const Layer = memo(function Layer({ ink, lit }: { ink: Ink; lit?: boolean }) {
  return (
    <svg
      className="minimap__ink"
      data-lit={lit || undefined}
      width={WIDTH}
      aria-hidden="true"
      focusable="false"
    >
      <path className="minimap__wash" d={ink.wash} />
      <path className="minimap__frame" fillRule="evenodd" d={ink.frame} />
      <path className="minimap__prose" d={ink.prose} />
      <path className="minimap__code" d={ink.code} />
      <g data-read="">
        <path className="minimap__wash" d={ink.washRead} />
        <path className="minimap__frame" fillRule="evenodd" d={ink.frameRead} />
        <path className="minimap__prose" d={ink.proseRead} />
        <path className="minimap__code" d={ink.codeRead} />
      </g>
      <path className="minimap__tick" d={ink.ticks} />
      <path className="minimap__part" d={ink.parts} />
      <path className="minimap__hit" d={ink.hits} />
    </svg>
  );
});

function shift(y: number): string {
  return `translate3d(0, ${round(y)}px, 0)`;
}

/** The box of a tick that is drawn as an element, over the ink of the same tick. */
function tickStyle(depth: number, y: number): CSSProperties {
  const tick = tickOf(depth);
  return { left: TICKS_RIGHT - tick.width, ...tick, transform: shift(y) };
}

export function Minimap({ document: source }: { document: MarkdownDocument }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const litRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);

  const [measured, setMeasured] = useState<Measured | null>(null);
  /** Index of the section under the pointer, or `null` when the pointer is away. */
  const [tip, setTip] = useState<number | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const read = usePrefs((prefs) => prefs.read);
  const currentSection = useCurrentSection();
  const searchlight = useUi((state) => state.searchlight);
  const echo = useUi((state) => state.echo);

  const model = useMemo(() => buildModel(source), [source]);
  const readSet = useMemo(() => new Set(read), [read]);
  const ink = useMemo(
    () => (measured ? drawInk(source, model, measured, readSet) : null),
    [source, model, measured, readSet],
  );

  // What the per-frame and pointer code reads. Never read during render.
  const live = useRef({
    measured,
    starts: ink?.starts ?? [],
    progress: 0,
    hovering: false,
    /** While the pointer holds the window: how far under its top. */
    grab: null as number | null,
    percent: -1,
    /** The text of the current section, for the slider value. */
    current: undefined as string | undefined,
  });

  /** Puts the window where the scroll is. Transform only, on two small elements. */
  const place = useCallback(() => {
    const state = live.current;
    const pane = windowRef.current;
    const lit = litRef.current;
    if (!state.measured || !pane || !lit) return;
    const { geometry, ratio } = state.measured;
    const top = Math.round(windowTop(geometry, state.progress) * ratio) / ratio;
    pane.style.transform = shift(top);
    // The lit layer moves the other way: it stays still on the strip.
    lit.style.transform = shift(-top);
    // Without a pointer the label names the place of the window (keyboard).
    if (!state.hovering && labelRef.current) {
      labelRef.current.style.transform = `${shift(top + windowHeight(geometry) / 2)} translateY(-50%)`;
    }
  }, []);

  useEffect(() => {
    live.current.measured = measured;
    live.current.starts = ink?.starts ?? [];
    place();
  }, [measured, ink, place]);

  // The geometry: once after layout, then whenever the document or the strip
  // changes size (fonts, text size, a fold, a filter, the window).
  useEffect(() => {
    const strip = rootRef.current;
    const root = document.getElementById("doc");
    if (!strip || !root) return;

    let frame = 0;
    let alive = true;

    const measure = () => {
      frame = 0;
      // Below 60rem the strip is not shown: there is nothing to draw on.
      if (strip.clientHeight === 0) return;
      const scrollY = window.scrollY;
      const elements = source.blocks.map((block) => document.getElementById(block.id));
      const tops: number[] = [];
      const heights: number[] = [];
      for (const element of elements) {
        const box = element?.getBoundingClientRect();
        tops.push(box ? box.top + scrollY : Number.NaN);
        heights.push(box ? box.height : Number.NaN);
      }
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const next: Measured = {
        geometry: {
          strip: strip.clientHeight,
          page: document.documentElement.scrollHeight,
          viewport: window.innerHeight,
        },
        ratio: window.devicePixelRatio || 1,
        line: rem * PROSE_LINE_REM,
        tops,
        heights,
        hits: findHits(root, model, elements, tops, heights, scrollY),
      };
      setMeasured((previous) => (sameMeasure(previous, next) ? previous : next));
    };

    const schedule = () => {
      if (alive) frame ||= window.requestAnimationFrame(measure);
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    observer.observe(strip);
    // A late font can move lines without changing a height the observer sees.
    void document.fonts?.ready.then(schedule);
    schedule();

    return () => {
      alive = false;
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
    // The lit words (`searchlight`, `echo`) are found again in `measure`.
  }, [source, model, searchlight, echo]);

  /** The slider value: written to the element, not to state, as the scroll moves it. */
  const writeValue = useCallback(() => {
    const { percent, current } = live.current;
    const root = rootRef.current;
    if (!root || percent === -1) return;
    root.setAttribute("aria-valuenow", String(percent));
    root.setAttribute("aria-valuetext", current ? `${percent}%, ${current}` : `${percent}%`);
  }, []);

  // The window follows the scroll, at most once per frame.
  useEffect(
    () =>
      onScrollProgress((progress) => {
        live.current.progress = progress;
        place();
        const percent = Math.round(progress * 100);
        if (percent === live.current.percent) return;
        live.current.percent = percent;
        writeValue();
      }),
    [place, writeValue],
  );

  // ── Pointer: hover names the section, click or drag scrubs ─────────────

  const pointerY = (event: ReactPointerEvent<HTMLDivElement>) =>
    event.clientY - event.currentTarget.getBoundingClientRect().top;

  const hover = (y: number) => {
    const state = live.current;
    if (!state.measured) return;
    state.hovering = true;
    const { strip } = state.measured.geometry;
    if (cursorRef.current) cursorRef.current.style.transform = shift(clamp(y, 0, strip - 1));
    if (labelRef.current) {
      labelRef.current.style.transform = `${shift(clamp(y, 16, strip - 16))} translateY(-50%)`;
    }
    const index = sectionAt(state.starts, y);
    setTip(index === -1 ? null : index);
  };

  const leave = () => {
    live.current.hovering = false;
    setTip(null);
    place();
  };

  const scrub = (y: number) => {
    const state = live.current;
    if (!state.measured || state.grab === null) return;
    const { geometry } = state.measured;
    const top = scrubTarget(geometry, y, state.grab);
    const maxScroll = Math.max(0, geometry.page - geometry.viewport);
    // The window moves now; the scroll listener agrees a frame later.
    state.progress = maxScroll > 0 ? top / maxScroll : 0;
    place();
    window.scrollTo({ top, behavior: "instant" });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = live.current;
    if (event.button !== 0 || !state.measured) return;
    const y = pointerY(event);
    const { geometry } = state.measured;
    const top = windowTop(geometry, state.progress);
    const height = windowHeight(geometry);
    // Inside the window: hold it where it was taken. Outside: centre it there.
    state.grab = y >= top && y <= top + height ? y - top : height / 2;
    event.currentTarget.setPointerCapture(event.pointerId);
    setScrubbing(true);
    hover(y);
    scrub(y);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const y = pointerY(event);
    hover(y);
    scrub(y);
  };

  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (live.current.grab === null) return;
    live.current.grab = null;
    setScrubbing(false);
    // The pointer was let go outside the strip: there is nothing to name.
    const box = event.currentTarget.getBoundingClientRect();
    const inside =
      event.clientX >= box.left &&
      event.clientX <= box.right &&
      event.clientY >= box.top &&
      event.clientY <= box.bottom;
    if (!inside) leave();
  };

  const onPointerLeave = () => {
    // A captured pointer still belongs to the strip.
    if (live.current.grab === null) leave();
  };

  // ── Keys: a slider ─────────────────────────────────────────────────────

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const state = live.current;
    if (!state.measured || event.altKey || event.ctrlKey || event.metaKey) return;
    const top = keyTarget(event.key, state.measured.geometry, window.scrollY);
    if (top === null) return;
    event.preventDefault();
    window.scrollTo({ top, behavior: "instant" });
  };

  const sections = source.sections;
  const currentIndex = currentSection
    ? sections.findIndex((section) => section.id === currentSection)
    : -1;
  const current = currentIndex === -1 ? undefined : sections[currentIndex];
  const named = tip === null ? current : sections[tip];
  const hereY = ink && currentIndex !== -1 ? ink.starts[currentIndex] : Number.NaN;
  const markY = ink && tip !== null ? ink.starts[tip] : Number.NaN;

  useEffect(() => {
    live.current.current = current?.text;
    writeValue();
  }, [current, writeValue]);

  return (
    <div
      ref={rootRef}
      className="minimap"
      role="slider"
      tabIndex={0}
      aria-label={copy.labels.map}
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={100}
      // Constant, so React never writes it again: `writeValue` keeps it current.
      aria-valuenow={0}
      data-ready={ink ? "" : undefined}
      data-hover={tip !== null ? "" : undefined}
      data-scrub={scrubbing ? "" : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onPointerLeave={onPointerLeave}
      onKeyDown={onKeyDown}
    >
      {ink && measured && (
        <>
          <Layer ink={ink} />
          <div
            ref={windowRef}
            className="minimap__window"
            style={{ height: Math.round(windowHeight(measured.geometry)) }}
          >
            <div ref={litRef} className="minimap__lit" style={{ height: measured.geometry.strip }}>
              <Layer ink={ink} lit />
            </div>
          </div>
          {current && !Number.isNaN(hereY) && (
            <div className="minimap__here" style={tickStyle(current.depth, hereY)} />
          )}
          {named && named !== current && !Number.isNaN(markY) && (
            <div className="minimap__mark" style={tickStyle(named.depth, markY)} />
          )}
          <div ref={cursorRef} className="minimap__cursor" />
          <div ref={labelRef} className="minimap__label">
            {named?.code && <span className="minimap__chip">{named.code}</span>}
            {named && <span className="minimap__title">{named.title}</span>}
          </div>
        </>
      )}
    </div>
  );
}
