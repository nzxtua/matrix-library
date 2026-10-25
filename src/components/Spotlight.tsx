import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { useNavigate } from "@tanstack/react-router";

import type { Doc } from "#/lib/content";
import { copy } from "#/lib/copy";
import { clearHighlight, paintHighlight, rangesOf } from "#/lib/highlight";
import { TOOL_KEYS, formatKeys, useHotkeys } from "#/lib/hotkeys";
import type { Hotkey } from "#/lib/hotkeys";
import { copyText, jumpTo, linkTo, ping } from "#/lib/jump";
import type { MarkdownDocument, Section } from "#/lib/markdown";
import { MOTIONS, SIZES, clearPrefs, setPrefs, usePrefs } from "#/lib/prefs";
import { useCurrentSection } from "#/lib/reading";
import { buildIndex, hasEveryWord, matchEntries, queryWords, search } from "#/lib/search";
import type { SearchEntry, SearchHit, SearchIndex, Snippet } from "#/lib/search";
import { toast } from "#/lib/toast";
import {
  closeOverlay,
  getUi,
  openOverlay,
  setRuler,
  setSearchlight,
  setTorch,
  toggleOverlay,
  useUi,
} from "#/lib/ui";
import { useOverlayDialog } from "#/lib/use-overlay-dialog";
import { isUnlocked, setVibe, VIBES } from "#/lib/vibes";

/** At most this many results are rendered. The count still shows them all. */
const MAX_RESULTS = 40;
/** At most this many ranges are painted by the searchlight. */
const MAX_RANGES = 4000;
/** Air between the card and the block that is peeked at, and under it. */
const PEEK_GAP = 28;
/** With less room than this under the card there is no peek window (a phone). */
const PEEK_MIN = 140;
/** The light around the peeked block is this much larger than the block. */
const BEAM_PAD = 12;
/** A searchlight step puts the hit this far down the viewport. */
const STEP_LINE = 0.4;
/** Set on every element the searchlight keeps lit. Styled in `spotlight.css`. */
const HIT_ATTR = "data-searchlight-hit";

/* ─────────────────────────────── The document ─────────────────────────────── */

const indexes = new WeakMap<MarkdownDocument, SearchIndex>();

/** The index of a document. Built on first use, then kept. */
function indexFor(document: MarkdownDocument): SearchIndex {
  let index = indexes.get(document);
  if (!index) {
    index = buildIndex(document);
    indexes.set(document, index);
  }
  return index;
}

/** The element of an entry: the row, the list item, or the block. */
function elementOf(entry: SearchEntry): HTMLElement | null {
  const block = document.getElementById(entry.blockId);
  if (!block) return null;

  let part: HTMLElement | null | undefined;
  if (entry.rowId) part = document.getElementById(entry.rowId);
  else if (entry.item !== undefined) {
    part = block.querySelectorAll<HTMLElement>(":scope > ul > li, :scope > ol > li")[entry.item];
  }
  // A row that a table filter hides has no box: the table stands in for it.
  return part && part.getClientRects().length > 0 ? part : block;
}

/** The element of a section: the block of its heading. */
function elementOfSection(section: Section): HTMLElement | null {
  const heading = document.getElementById(section.id);
  return heading?.closest<HTMLElement>(".doc__block") ?? heading;
}

/** Every place of every word inside `root`. */
function wordRanges(root: Element, words: readonly string[]): Range[] {
  return words.flatMap((word) => rangesOf(root, word));
}

/** The box of the range that comes first on the page. */
function firstBox(ranges: Range[]): DOMRect | null {
  let first: DOMRect | null = null;
  for (const range of ranges.slice(0, 60)) {
    const box = range.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    if (!first || box.top < first.top || (box.top === first.top && box.left < first.left)) {
      first = box;
    }
  }
  return first;
}

function scrollByInstant(top: number) {
  window.scrollBy({ top, behavior: "instant" });
}

/* ──────────────────────────────── Section hops ─────────────────────────────── */

/**
 * The section a hop goes to, or -1. `current` is the index of the section the
 * reader is in (-1: before the first one). `pastStart`: the reader is below
 * the start of that section; going back then goes to its start first.
 */
export function hopIndex(
  count: number,
  current: number,
  direction: 1 | -1,
  pastStart: boolean,
): number {
  const target = direction === 1 ? current + 1 : pastStart ? current : current - 1;
  return target >= 0 && target < count ? target : -1;
}

/**
 * The last hop, while the page has not moved since. The reading tracker
 * follows a jump a frame later, and a section near the end of the page never
 * reaches the reading line: the next hop starts from where the last one went.
 */
let lastHop: { index: number; y: number } | null = null;

/** Next (1) or previous (-1) section, from the reader's section `currentId`. With a ping. */
function hopSection(doc: MarkdownDocument, currentId: string | undefined, direction: 1 | -1) {
  const { sections } = doc;
  let current = sections.findIndex((section) => section.id === currentId);
  let pastStart = false;
  if (lastHop && Math.abs(window.scrollY - lastHop.y) < 2) {
    current = lastHop.index;
  } else if (current >= 0) {
    const start = elementOfSection(sections[current]);
    if (start) {
      const margin = Number.parseFloat(getComputedStyle(start).scrollMarginTop) || 0;
      pastStart = start.getBoundingClientRect().top < margin - 4;
    }
  }

  const index = hopIndex(sections.length, current, direction, pastStart);
  const target = index >= 0 ? elementOfSection(sections[index]) : null;
  if (!target) return;
  jumpTo(target, { ping: true, focus: true });
  lastHop = { index, y: window.scrollY };
}

/** Back to the top of the page. The focus goes there too. */
function goToTop() {
  lastHop = null;
  window.scrollTo({ top: 0, behavior: "instant" });
  const first = document.querySelector<HTMLElement>("#doc > .doc__block");
  if (!first) return;
  if (!first.hasAttribute("tabindex")) first.tabIndex = -1;
  first.focus({ preventScroll: true });
}

/**
 * The Markdown of a section as the document has it: the raw source of its
 * blocks, a blank line between them.
 */
export function sectionMarkdown(doc: MarkdownDocument, sectionId: string): string {
  const section = doc.sections.find((known) => known.id === sectionId);
  if (!section) return "";
  const ids = new Set(section.blockIds);
  const parts = doc.blocks
    .filter((block) => ids.has(block.id))
    .map((block) => block.token.raw.replace(/^\n+|\n+$/g, ""))
    .filter((raw) => raw.trim() !== "");
  return parts.length > 0 ? `${parts.join("\n\n")}\n` : "";
}

/* ─────────────────────────────────── Peek ─────────────────────────────────── */

/** Puts the hole of the dimmer on `box`, or closes it. */
function placeBeam(beam: HTMLElement, box: DOMRect | null) {
  if (!box) {
    beam.removeAttribute("data-on");
    beam.style.cssText = "";
    return;
  }
  const edge = 6;
  const left = Math.max(edge, box.left - BEAM_PAD);
  const right = Math.min(window.innerWidth - edge, box.right + BEAM_PAD);
  beam.style.transform = `translate(${Math.round(left)}px, ${Math.round(box.top - BEAM_PAD)}px)`;
  beam.style.width = `${Math.round(right - left)}px`;
  beam.style.height = `${Math.round(box.height + BEAM_PAD * 2)}px`;
  beam.setAttribute("data-on", "");
}

/**
 * Scrolls the document behind the dialog so `target` shows under the card,
 * marks the words in it and opens the dimmer over it.
 */
function peekAt(
  target: HTMLElement,
  words: readonly string[],
  card: HTMLElement,
  beam: HTMLElement,
) {
  const ranges = wordRanges(target, words);
  paintHighlight("search", ranges);

  // The window starts where the card ends at its tallest, so the document
  // does not move when the list gets shorter.
  const cardBox = card.getBoundingClientRect();
  const tallest = Number.parseFloat(getComputedStyle(card).maxHeight);
  const top = cardBox.top + (Number.isFinite(tallest) ? tallest : cardBox.height) + PEEK_GAP;
  const room = window.innerHeight - PEEK_GAP - top;

  if (room < PEEK_MIN) {
    target.scrollIntoView({ block: "start", behavior: "instant" });
    placeBeam(beam, null);
    return;
  }

  const box = target.getBoundingClientRect();
  const hit = firstBox(ranges) ?? box;
  // A block that fits shows whole. A taller one shows its first hit.
  const fits = box.height + BEAM_PAD * 2 <= room;
  scrollByInstant(fits ? box.top - BEAM_PAD - top : hit.top + hit.height / 2 - (top + room / 2));
  placeBeam(beam, target.getBoundingClientRect());
}

/* ───────────────────────────────── Commands ───────────────────────────────── */

interface Command {
  id: string;
  label: string;
  note?: string;
  /** A colour dot: the vibes. */
  swatch?: string;
  keys?: string[];
  /** The setting that is on now. */
  checked?: boolean;
  locked?: boolean;
  /** The dialog stays open: the reader sees the change and may pick again. */
  keep?: boolean;
  /**
   * It goes to a place in the document: `run` runs once the dialog has
   * closed, instead of the return to where the reader was.
   */
  place?: boolean;
  run: (origin?: { x: number; y: number }) => void;
}

interface CommandGroup {
  id: string;
  label: string;
  commands: Command[];
}

/** `current`: the id of the section the reader is in. */
function useCommandGroups(doc: MarkdownDocument, current: string | undefined): CommandGroup[] {
  const vibe = usePrefs((prefs) => prefs.vibe);
  const size = usePrefs((prefs) => prefs.size);
  const motion = usePrefs((prefs) => prefs.motion);
  const cryo = usePrefs((prefs) => isUnlocked("cryo", prefs));
  const ruler = useUi((state) => state.ruler);
  const torch = useUi((state) => state.torch);

  return useMemo(() => {
    // Before the tracker knows the place, the reader is at the start.
    const here = doc.sections.find((section) => section.id === current) ?? doc.sections[0];
    const sectionId = here?.id;
    /** The copy commands say which section they take. */
    const hereNote = here && (here.code ? `${here.code} ${here.title}` : here.title);
    const sections: CommandGroup[] = sectionId
      ? [
          {
            id: "sections",
            label: copy.labels.sections,
            commands: [
              {
                id: "section-next",
                label: copy.labels.sectionNext,
                keys: formatKeys(TOOL_KEYS.sectionNext),
                place: true,
                run: () => hopSection(doc, current, 1),
              },
              {
                id: "section-previous",
                label: copy.labels.sectionPrevious,
                keys: formatKeys(TOOL_KEYS.sectionPrevious),
                place: true,
                run: () => hopSection(doc, current, -1),
              },
              {
                id: "top",
                label: copy.labels.top,
                keys: formatKeys(TOOL_KEYS.top),
                place: true,
                run: goToTop,
              },
              {
                id: "copy-section",
                label: copy.labels.copySection,
                note: hereNote,
                run: () => {
                  void copyText(sectionMarkdown(doc, sectionId), copy.labels.sectionCopied);
                  closeOverlay();
                },
              },
              {
                id: "section-link",
                label: copy.labels.sectionLink,
                note: hereNote,
                run: () => {
                  void copyText(linkTo(sectionId), copy.linkCopied);
                  closeOverlay();
                },
              },
            ],
          },
        ]
      : [];

    return [
      {
        id: "light",
        label: copy.comfort.light,
        commands: VIBES.map((entry) => {
          const locked = entry.id === "cryo" && !cryo;
          return {
            id: `vibe-${entry.id}`,
            label: entry.label,
            note: locked ? copy.comfort.locked : entry.note,
            swatch: entry.swatch,
            checked: entry.id === vibe,
            locked,
            keep: true,
            run: (origin) => setVibe(entry.id, origin),
          };
        }),
      },
      {
        id: "text",
        label: copy.comfort.text,
        commands: SIZES.map((id) => ({
          id: `size-${id}`,
          label: copy.labels.sizes[id],
          checked: id === size,
          keep: true,
          run: () => setPrefs({ size: id }),
        })),
      },
      {
        id: "motion",
        label: copy.comfort.motion,
        commands: MOTIONS.map((id) => ({
          id: `motion-${id}`,
          label: copy.labels.motions[id],
          checked: id === motion,
          keep: true,
          run: () => setPrefs({ motion: id }),
        })),
      },
      {
        id: "tools",
        label: copy.labels.commands,
        commands: [
          {
            id: "ruler",
            label: copy.labels.ruler,
            keys: formatKeys(TOOL_KEYS.ruler),
            checked: ruler,
            run: () => {
              setRuler(!getUi().ruler);
              closeOverlay();
            },
          },
          {
            id: "torch",
            label: copy.labels.torch,
            keys: formatKeys(TOOL_KEYS.torch),
            checked: torch,
            run: () => {
              setTorch(!getUi().torch);
              closeOverlay();
            },
          },
          {
            id: "lights-out",
            label: copy.labels.lightsOut,
            keys: formatKeys(TOOL_KEYS.lightsOut),
            run: () => openOverlay("curtain"),
          },
          {
            id: "keys",
            label: copy.labels.keys,
            keys: formatKeys(TOOL_KEYS.keys),
            run: () => openOverlay("keymap"),
          },
          {
            id: "clear",
            label: copy.comfort.clear,
            run: () => {
              clearPrefs();
              toast(copy.comfort.cleared);
              closeOverlay();
            },
          },
        ],
      },
      ...sections,
    ];
  }, [vibe, size, motion, cryo, ruler, torch, doc, current]);
}

/* ────────────────────────────────── Options ───────────────────────────────── */

type Option =
  | { type: "hit"; key: string; hit: SearchHit }
  | { type: "section"; key: string; section: Section }
  | { type: "command"; key: string; command: Command }
  /** A hit in another document: it opens that document there. */
  | { type: "away"; key: string; hit: SearchHit; doc: Doc }
  /** Another document: it opens at its top. */
  | { type: "doc"; key: string; doc: Doc };

/** The most hits shown from each of the other documents. */
const AWAY_HITS = 3;

/** "03": the place of a document on the shelf. */
function shelfNumber(doc: Doc): string {
  return String(doc.index + 1).padStart(2, "0");
}

interface OptionGroup {
  key: string;
  /** The code chip of a section. */
  code?: string;
  title: string;
  /** The first option is the heading of this very section: the head would say it twice. */
  quiet?: boolean;
  options: Option[];
}

type Mode = "sections" | "search" | "commands";

function modeOf(query: string): Mode {
  if (query.trimStart().startsWith(">")) return "commands";
  return query.trim() ? "search" : "sections";
}

function Marked({ snippet }: { snippet: Snippet }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of snippet.hits) {
    if (start > at) parts.push(snippet.text.slice(at, start));
    parts.push(<mark key={start}>{snippet.text.slice(start, end)}</mark>);
    at = end;
  }
  if (at < snippet.text.length) parts.push(snippet.text.slice(at));
  return <>{parts}</>;
}

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="spotlight__keys">
      {keys.map((key) => (
        <kbd key={key}>{key}</kbd>
      ))}
    </span>
  );
}

function OptionBody({ option }: { option: Option }) {
  if (option.type === "section") {
    const { section } = option;
    return (
      <>
        {section.code && <span className="spotlight__chip">{section.code}</span>}
        <span className="spotlight__title">{section.title}</span>
        <span className="spotlight__meta">{copy.minutes(section.minutes)}</span>
      </>
    );
  }

  if (option.type === "doc") {
    const { doc } = option;
    return (
      <>
        <span className="spotlight__chip">{shelfNumber(doc)}</span>
        <span className="spotlight__title">{doc.title}</span>
        <span className="spotlight__meta">{copy.minutes(doc.document.stats.minutes)}</span>
      </>
    );
  }

  if (option.type === "command") {
    const { command } = option;
    return (
      <>
        {command.swatch && (
          <span
            className="spotlight__swatch"
            style={{ background: command.swatch }}
            aria-hidden="true"
          />
        )}
        <span className="spotlight__title">{command.label}</span>
        {command.note && <span className="spotlight__note">{command.note}</span>}
        {command.locked && <span className="sr-only">{copy.labels.locked}</span>}
        {command.keys && <Keys keys={command.keys} />}
        {command.checked && <span className="spotlight__on" aria-hidden="true" />}
      </>
    );
  }

  const { entry, lead, snippet } = option.hit;
  if (entry.kind === "heading") {
    return (
      <span className="spotlight__title">
        <Marked snippet={snippet} />
      </span>
    );
  }
  return (
    <>
      <span className="spotlight__text">
        {lead && (
          <span className="spotlight__lead">
            <Marked snippet={lead} />
          </span>
        )}
        {snippet.text && (
          <span className="spotlight__snippet">
            <Marked snippet={snippet} />
          </span>
        )}
      </span>
      {entry.under && <span className="spotlight__meta spotlight__under">{entry.under}</span>}
    </>
  );
}

/* ─────────────────────────────── The dialog card ───────────────────────────── */

interface CardProps {
  document: MarkdownDocument;
  /** Every other document: search goes there too. */
  others: readonly Doc[];
  beamRef: RefObject<HTMLDivElement | null>;
  /** What happens to the page after the dialog has closed. `null`: nothing. */
  exit: RefObject<(() => void) | null>;
  /**
   * Where the page was when the dialog opened. Nothing to peek at: the page
   * goes back there. `null` until the dialog has opened (child effects run first).
   */
  origin: RefObject<number | null>;
  /** Starts the searchlight at the entry with this `order`. */
  onLight: (order: number) => void;
  /** The card puts its "start the searchlight" here, for the `shift+enter` key. */
  lightRef: RefObject<(() => void) | null>;
}

/** "↑↓ peek" is the keys "↑↓" and the word "peek". */
function splitHint(hint: string): { keys: string; word: string } {
  const space = hint.indexOf(" ");
  return space === -1
    ? { keys: "", word: hint }
    : { keys: hint.slice(0, space), word: hint.slice(space + 1) };
}

/**
 * The parts of `copy.search.hint`, in its order: peek, go, searchlight, back.
 * Three of them are also buttons, so a reader without a keyboard has them.
 */
const HINTS = copy.search.hint.split(" · ").map(splitHint);
const HINT_ACTIONS = ["peek", "go", "light", "back"] as const;

function SpotlightCard({
  document: doc,
  others,
  beamRef,
  exit,
  origin,
  onLight,
  lightRef,
}: CardProps) {
  const navigate = useNavigate();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // A searchlight that is on gives its query back: the reader refines it.
  const [query, setQuery] = useState(() => getUi().searchlight ?? "");
  /** The chosen option. `null`: the reader has not chosen yet. */
  const [chosen, setChosen] = useState<number | null>(null);
  const currentSection = useCurrentSection();
  const commandGroups = useCommandGroups(doc, currentSection);

  const mode = modeOf(query);
  const results = useMemo(
    () => (mode === "search" ? search(indexFor(doc), query, { limit: MAX_RESULTS }) : null),
    [doc, mode, query],
  );
  /** The best few hits in each other document, in shelf order. */
  const away = useMemo(
    () =>
      mode === "search"
        ? others
            .map((other) => ({
              doc: other,
              results: search(indexFor(other.document), query, { limit: AWAY_HITS }),
            }))
            .filter((found) => found.results.total > 0)
        : [],
    [others, mode, query],
  );

  const groups = useMemo<OptionGroup[]>(() => {
    if (mode === "search") {
      const here = (results?.groups ?? []).map((group, index): OptionGroup => {
        const [first] = group.hits;
        const section = group.section;
        return {
          key: section?.id ?? `g${index}`,
          code: section?.code,
          title: section?.title ?? "",
          quiet:
            first.entry.kind === "heading" &&
            section !== undefined &&
            first.entry.text === section.text,
          options: group.hits.map((hit) => ({ type: "hit", key: `h${hit.entry.order}`, hit })),
        };
      });
      const elsewhere = away.map(({ doc: other, results: found }): OptionGroup => ({
        key: `d:${other.slug}`,
        code: shelfNumber(other),
        title: other.title,
        options: found.hits.map((hit) => ({
          type: "away",
          key: `${other.slug}:${hit.entry.order}`,
          hit,
          doc: other,
        })),
      }));
      return [...here, ...elsewhere];
    }

    if (mode === "commands") {
      const words = queryWords(query.replace(">", " "));
      return commandGroups
        .map((group) => ({
          key: group.id,
          title: group.label,
          options: group.commands
            .filter((command) =>
              hasEveryWord(`${group.label} ${command.label} ${command.note ?? ""}`, words),
            )
            .map((command): Option => ({ type: "command", key: command.id, command })),
        }))
        .filter((group) => group.options.length > 0);
    }

    const lists: OptionGroup[] = [];
    if (doc.sections.length > 0) {
      lists.push({
        key: "sections",
        title: copy.labels.sections,
        options: doc.sections.map((section) => ({ type: "section", key: section.id, section })),
      });
    }
    if (others.length > 0) {
      lists.push({
        key: "documents",
        title: copy.library.elsewhere,
        options: others.map((other) => ({ type: "doc", key: `d:${other.slug}`, doc: other })),
      });
    }
    return lists;
  }, [mode, results, away, query, commandGroups, doc, others]);

  const options = useMemo(() => groups.flatMap((group) => group.options), [groups]);

  // Before the reader chooses: the best result, or the section they are in.
  let fallback = 0;
  if (mode === "sections") {
    fallback = Math.max(
      0,
      options.findIndex((option) => option.type === "section" && option.key === currentSection),
    );
  }
  const active = Math.min(chosen ?? fallback, options.length - 1);
  const activeOption: Option | undefined = options[active];
  /** A list of sections does not move the page until the reader moves in it. */
  const peeking = mode === "search" || (mode === "sections" && chosen !== null);
  const words = results?.words;

  // Peek: the document goes to the chosen result, behind the dialog.
  useEffect(() => {
    const beam = beamRef.current;
    const card = cardRef.current;
    if (!beam || !card) return;

    let target: HTMLElement | null = null;
    if (peeking && activeOption?.type === "hit") target = elementOf(activeOption.hit.entry);
    else if (peeking && activeOption?.type === "section") {
      target = elementOfSection(activeOption.section);
    }

    if (!target) {
      placeBeam(beam, null);
      clearHighlight("search");
      // Nothing found, or the commands: the reader sees their own place again.
      if (origin.current !== null && Math.abs(window.scrollY - origin.current) > 1) {
        window.scrollTo({ top: origin.current, behavior: "instant" });
      }
      return;
    }

    const found = target;
    const look = () => peekAt(found, words ?? [], card, beam);
    // After the paint of the key that was typed: typing stays instant.
    const frame = requestAnimationFrame(look);
    window.addEventListener("resize", look);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", look);
    };
  }, [activeOption, peeking, words, beamRef, origin]);

  // The chosen option stays in view, with the head of its group when it is the first.
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>("[aria-selected='true']");
    if (!list || !item) return;
    const head = item.previousElementSibling?.matches(".spotlight__head")
      ? (item.previousElementSibling as HTMLElement)
      : item;
    const top = head.offsetTop;
    const bottom = item.offsetTop + item.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = Math.max(0, top - 6);
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight + 6;
    }
  }, [active, options]);

  // A phone keyboard covers the bottom of the page: the card ends above it.
  useEffect(() => {
    const viewport = window.visualViewport;
    const card = cardRef.current;
    if (!viewport || !card) return;
    const fit = () =>
      card.style.setProperty("--spotlight-view", `${Math.round(viewport.height)}px`);
    fit();
    viewport.addEventListener("resize", fit);
    return () => viewport.removeEventListener("resize", fit);
  }, []);

  const type = (value: string) => {
    setQuery(value);
    setChosen(null);
    if (listRef.current) listRef.current.scrollTop = 0;
  };

  const move = (step: number) => {
    if (options.length === 0) return;
    setChosen((active + step + options.length) % options.length);
  };

  const back = () => closeOverlay();

  const run = (option: Option | undefined, origin?: { x: number; y: number }) => {
    if (!option) return;

    if (option.type === "command") {
      if (option.command.locked) return;
      if (option.command.place) {
        exit.current = () => option.command.run();
        closeOverlay();
        return;
      }
      option.command.run(origin);
      if (option.command.keep) inputRef.current?.focus({ preventScroll: true });
      return;
    }

    // Another document: it opens once the dialog has closed.
    if (option.type === "away" || option.type === "doc") {
      const slug = option.doc.slug;
      const hash =
        option.type === "away" ? (option.hit.entry.rowId ?? option.hit.entry.blockId) : undefined;
      exit.current = () => void navigate({ to: "/content/$slug", params: { slug }, hash });
      closeOverlay();
      return;
    }

    const target =
      option.type === "hit" ? elementOf(option.hit.entry) : elementOfSection(option.section);
    if (!target) return;
    exit.current = () => jumpTo(target, { ping: true, focus: true });
    closeOverlay();
  };

  const light = () => {
    if (activeOption?.type !== "hit") return;
    exit.current = null;
    onLight(activeOption.hit.entry.order);
    setSearchlight(query.trim());
    closeOverlay();
  };
  const canLight = activeOption?.type === "hit";

  // The key is registered by the dialog; it calls the `light` of the last render.
  useEffect(() => {
    lightRef.current = light;
    return () => {
      lightRef.current = null;
    };
  });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      // The new light of a vibe spreads from its dot.
      const dot = listRef.current
        ?.querySelector("[aria-selected='true'] .spotlight__swatch")
        ?.getBoundingClientRect();
      run(activeOption, dot && { x: dot.left + dot.width / 2, y: dot.top + dot.height / 2 });
    }
  };

  const toggleCommands = () => {
    type(mode === "commands" ? "" : ">");
    inputRef.current?.focus({ preventScroll: true });
  };

  const hintActions: Record<(typeof HINT_ACTIONS)[number], (() => void) | undefined> = {
    peek: undefined,
    go: () => run(activeOption),
    light,
    back,
  };

  const total =
    mode === "search"
      ? (results?.total ?? 0) + away.reduce((sum, found) => sum + found.results.total, 0)
      : options.length;
  const empty = options.length === 0;
  const capped = mode === "search" && total > options.length;
  let status: string = copy.labels.rows(options.length, total);
  if (empty) status = copy.search.empty;

  const indexOf = new Map(options.map((option, index) => [option, index]));

  return (
    <div ref={cardRef} className="spotlight__card" data-mode={mode} data-empty={empty || undefined}>
      <div className="spotlight__field">
        <svg className="spotlight__glyph" viewBox="0 0 20 20" aria-hidden="true" data-lit={!empty}>
          <circle cx="8.5" cy="8.5" r="5.25" />
          <path d="m12.6 12.6 4.4 4.4" />
        </svg>
        <input
          ref={inputRef}
          className="spotlight__input"
          type="text"
          role="combobox"
          aria-label={copy.labels.search}
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? `${baseId}-o${active}` : undefined}
          placeholder={copy.search.placeholder}
          value={query}
          onChange={(event) => type(event.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        {!empty && (
          <span className="spotlight__count" aria-hidden="true">
            {active + 1}
            <i>/</i>
            {total}
          </span>
        )}
        <button
          type="button"
          className="spotlight__mode"
          aria-pressed={mode === "commands"}
          onClick={toggleCommands}
        >
          <kbd>&gt;</kbd>
          {copy.labels.commands}
        </button>
      </div>

      <div
        ref={listRef}
        id={listId}
        className="spotlight__list"
        role="listbox"
        aria-label={mode === "commands" ? copy.labels.commands : copy.labels.search}
        // The field keeps the focus: a click in the list must not take it.
        onMouseDown={(event) => event.preventDefault()}
      >
        {groups.map((group, groupIndex) => {
          const headId = `${baseId}-g${groupIndex}`;
          return (
            <div key={group.key} className="spotlight__group" role="group" aria-labelledby={headId}>
              <div id={headId} className={group.quiet ? "sr-only" : "spotlight__head"}>
                {group.code && <span className="spotlight__chip">{group.code}</span>}
                <span>{group.title}</span>
              </div>
              {group.options.map((option) => {
                const index = indexOf.get(option) ?? 0;
                const locked = option.type === "command" && option.command.locked;
                return (
                  <div
                    key={option.key}
                    id={`${baseId}-o${index}`}
                    className="spotlight__option"
                    role="option"
                    aria-selected={index === active}
                    aria-disabled={locked || undefined}
                    aria-checked={option.type === "command" ? !!option.command.checked : undefined}
                    data-kind={
                      option.type === "hit" || option.type === "away"
                        ? option.hit.entry.kind
                        : option.type
                    }
                    data-part={
                      option.type === "section" && option.section.depth === 1 ? "" : undefined
                    }
                    onPointerMove={(event) => {
                      if (event.pointerType === "mouse" && index !== active) setChosen(index);
                    }}
                    onClick={(event) => run(option, { x: event.clientX, y: event.clientY })}
                  >
                    <OptionBody option={option} />
                  </div>
                );
              })}
            </div>
          );
        })}
        {empty && <p className="spotlight__empty">{copy.search.empty}</p>}
        {capped && <p className="spotlight__more">{copy.labels.rows(options.length, total)}</p>}
      </div>

      <div className="spotlight__foot">
        {HINTS.length === HINT_ACTIONS.length ? (
          HINTS.map((hint, index) => {
            const name = HINT_ACTIONS[index];
            const action = hintActions[name];
            const body = (
              <>
                <kbd>{hint.keys}</kbd>
                {hint.word}
              </>
            );
            if (!action) {
              return (
                <span key={name} className="spotlight__hint" data-hint={name}>
                  {body}
                </span>
              );
            }
            const off = name === "light" ? !canLight : name === "go" && !activeOption;
            return (
              <button
                key={name}
                type="button"
                className="spotlight__hint"
                data-hint={name}
                aria-disabled={off || undefined}
                onClick={off ? undefined : action}
              >
                {body}
              </button>
            );
          })
        ) : (
          <span className="spotlight__hint">{copy.search.hint}</span>
        )}
      </div>

      <span className="sr-only" role="status">
        {status}
      </span>
    </div>
  );
}

/* ───────────────────────────────── The dialog ──────────────────────────────── */

function SpotlightDialog({
  document: doc,
  others,
  onLight,
}: {
  document: MarkdownDocument;
  others: readonly Doc[];
  onLight: (order: number) => void;
}) {
  const { ref: dialogRef, open, dialogProps } = useOverlayDialog("spotlight");
  const beamRef = useRef<HTMLDivElement>(null);
  const exit = useRef<(() => void) | null>(null);
  const origin = useRef<number | null>(null);
  const lightRef = useRef<(() => void) | null>(null);

  useHotkeys([
    {
      keys: TOOL_KEYS.search,
      label: copy.labels.search,
      group: "find",
      allowInInput: true,
      // Also closes it, and takes over from the key map or the sheet.
      when: () => getUi().overlay !== "curtain",
      run: () => toggleOverlay("spotlight"),
    },
    {
      keys: "/",
      label: copy.labels.search,
      group: "find",
      run: () => openOverlay("spotlight"),
    },
    {
      keys: "shift+enter",
      label: copy.labels.searchlight,
      group: "find",
      // It is pressed in the field.
      allowInInput: true,
      when: () => getUi().overlay === "spotlight",
      run: () => lightRef.current?.(),
    },
  ]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    // Escape returns to where the reader was, unless a result was chosen.
    const top = window.scrollY;
    origin.current = top;
    exit.current = () => window.scrollTo({ top, behavior: "instant" });
    dialog.querySelector<HTMLInputElement>(".spotlight__input")?.select();

    return () => {
      clearHighlight("search");
      if (beamRef.current) placeBeam(beamRef.current, null);
      exit.current?.();
      exit.current = null;
      origin.current = null;
    };
  }, [open, dialogRef]);

  return (
    <dialog
      {...dialogProps}
      className="spotlight"
      aria-label={copy.labels.search}
      onCancel={(event) => {
        event.preventDefault();
        closeOverlay();
      }}
    >
      {/* The dimmer. Its hole is the light on the block that is peeked at. */}
      <div ref={beamRef} className="spotlight__beam" aria-hidden="true" />
      {open && (
        <SpotlightCard
          document={doc}
          others={others}
          beamRef={beamRef}
          exit={exit}
          origin={origin}
          onLight={onLight}
          lightRef={lightRef}
        />
      )}
    </dialog>
  );
}

/* ──────────────────────────────── Searchlight ──────────────────────────────── */

interface Lit {
  element: HTMLElement;
  /** The first place of a query word in the element, when there is one. */
  first?: Range;
}

/** "n / N step" is the keys "n" and "N" and the word "step". */
const STEP_HINT = /^(\S+) \/ (\S+) (.+)$/;
const END_HINT = /^(\S+) (.+)$/;

function Chevron({ up }: { up?: boolean }) {
  return (
    <svg className="searchlight__arrow" viewBox="0 0 16 16" aria-hidden="true">
      <path d={up ? "m3.5 10 4.5-4.5 4.5 4.5" : "m3.5 6 4.5 4.5 4.5-4.5"} />
    </svg>
  );
}

function Searchlight({
  document: doc,
  cursor,
  setCursor,
  reveal,
}: {
  document: MarkdownDocument;
  /** The `order` of the entry the reader is at. */
  cursor: number;
  setCursor: (order: number) => void;
  /** `true` once: the searchlight has just been started from the dialog. */
  reveal: RefObject<boolean>;
}) {
  const query = useUi((state) => state.searchlight);
  // The dialog has its own dimmer and its own marks: the searchlight waits.
  const waiting = useUi((state) => state.overlay === "spotlight");
  const on = query !== null && !waiting;

  const entries = useMemo(
    () => (query === null ? [] : matchEntries(indexFor(doc), query)),
    [doc, query],
  );
  const count = entries.length;
  const found = entries.findIndex((entry) => entry.order >= cursor);
  const at = count === 0 ? -1 : found === -1 ? count - 1 : found;

  const lit = useRef<Lit[]>([]);
  const nextRef = useRef<HTMLButtonElement>(null);

  /** Brings a hit into view and pings it. `false` when it has no box (a filtered row). */
  const show = (index: number): boolean => {
    const target = lit.current[index];
    if (!target || target.element.getClientRects().length === 0) return false;
    const box = target.element.getBoundingClientRect();
    const hit = target.first?.getBoundingClientRect();
    const view = window.innerHeight;
    // A hit that fits is centred a little above the middle. A tall one shows its first word.
    const fits = box.height <= view * 0.6;
    const middle =
      fits || !hit || hit.height === 0 ? box.top + Math.min(box.height, view * 0.6) / 2 : hit.top;
    scrollByInstant(middle - view * STEP_LINE);
    ping(target.element);
    return true;
  };

  useEffect(() => {
    if (!on || query === null) return;
    const words = queryWords(query);
    const root = document.documentElement;
    const targets: Lit[] = [];
    const ranges: Range[] = [];

    for (const entry of entries) {
      const element = elementOf(entry);
      if (!element) continue;
      const own = ranges.length < MAX_RANGES ? wordRanges(element, words) : [];
      for (const range of own) ranges.push(range);
      element.setAttribute(HIT_ATTR, "");
      targets.push({ element, first: own[0] });
    }

    lit.current = targets;
    paintHighlight("search", ranges);
    root.setAttribute("data-searchlight", "");

    return () => {
      for (const target of targets) target.element.removeAttribute(HIT_ATTR);
      lit.current = [];
      clearHighlight("search");
      root.removeAttribute("data-searchlight");
    };
  }, [on, query, entries]);

  // Started from the dialog: the page is at the chosen hit, and the keys are in the bar.
  useEffect(() => {
    if (!on || !reveal.current) return;
    reveal.current = false;
    if (at >= 0) show(at);
    nextRef.current?.focus({ preventScroll: true });
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs once per start, with what that render saw
  }, [on, query]);

  const step = (direction: 1 | -1) => {
    if (count === 0) return;
    // A hit without a box (a row the table filter hides) is stepped over.
    for (let tries = 1; tries <= count; tries++) {
      const next = (((at + direction * tries) % count) + count) % count;
      if (show(next)) {
        setCursor(entries[next].order);
        return;
      }
    }
  };

  /** Lights on. The keys were in the bar, which goes: they stay at the hit the reader is at. */
  const end = () => {
    const bar = nextRef.current?.closest(".searchlight");
    const target = at >= 0 ? lit.current[at]?.element : undefined;
    if (bar?.contains(document.activeElement) && target instanceof HTMLElement) {
      if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
    setSearchlight(null);
  };

  const lightIsOn = () => getUi().searchlight !== null && getUi().overlay === null;
  useHotkeys([
    {
      keys: "n",
      label: copy.labels.litNext,
      group: "find",
      when: lightIsOn,
      run: () => step(1),
    },
    {
      keys: "shift+n",
      label: copy.labels.litPrevious,
      group: "find",
      when: lightIsOn,
      run: () => step(-1),
    },
    {
      keys: "escape",
      label: copy.labels.close,
      group: "find",
      hidden: true,
      when: lightIsOn,
      run: end,
    },
  ]);

  // The bar stays while the dialog is open over it: the focus comes back to it.
  if (query === null) return null;

  const text = copy.searchlight.bar(count);
  const [litText, stepText = "", endText = ""] = text.split(" · ");
  const stepHint = STEP_HINT.exec(stepText);
  const endHint = END_HINT.exec(endText);
  const off = count === 0 || undefined;

  return (
    <div className="searchlight" role="group" aria-label={text}>
      <span className="searchlight__count">
        <i aria-hidden="true" />
        {at >= 0 && (
          <>
            <b>{at + 1}</b>
            <span aria-hidden="true">/</span>
          </>
        )}
        {stepHint && endHint ? litText : text}
      </span>

      <span className="searchlight__steps">
        <button
          ref={nextRef}
          type="button"
          className="searchlight__step"
          aria-label={copy.labels.next}
          aria-disabled={off}
          onClick={() => step(1)}
        >
          {stepHint && <kbd>{stepHint[1]}</kbd>}
          <Chevron />
        </button>
        <button
          type="button"
          className="searchlight__step"
          aria-label={copy.labels.previous}
          aria-disabled={off}
          onClick={() => step(-1)}
        >
          {stepHint && <kbd>{stepHint[2]}</kbd>}
          <Chevron up />
        </button>
        {stepHint && <span className="searchlight__word">{stepHint[3]}</span>}
      </span>

      <button
        type="button"
        className="searchlight__end"
        aria-label={endHint ? undefined : copy.labels.close}
        onClick={end}
      >
        {endHint ? (
          <>
            <kbd>{endHint[1]}</kbd>
            {endHint[2]}
          </>
        ) : (
          <svg className="searchlight__arrow" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 4 8 8m0-8-8 8" />
          </svg>
        )}
      </button>
    </div>
  );
}

/* ────────────────────────────────── Spotlight ──────────────────────────────── */

/** The keys that go places without the dialog: `]` and `[` hop sections, `t` goes to the top. */
function SectionHops({ document: doc }: { document: MarkdownDocument }) {
  const current = useCurrentSection();

  const hops: Hotkey[] =
    doc.sections.length > 0
      ? [
          {
            keys: TOOL_KEYS.sectionNext,
            label: copy.labels.sectionNext,
            group: "read",
            run: () => hopSection(doc, current, 1),
          },
          {
            keys: TOOL_KEYS.sectionPrevious,
            label: copy.labels.sectionPrevious,
            group: "read",
            run: () => hopSection(doc, current, -1),
          },
        ]
      : [];
  useHotkeys([
    ...hops,
    { keys: TOOL_KEYS.top, label: copy.labels.top, group: "read", run: goToTop },
  ]);

  return null;
}

/**
 * Owner: spotlight. Search (`mod+k`, `/`), the commands after ">", and the
 * searchlight (`shift+enter`): the hits stay lit on the page and `n` / `N`
 * step through them. Also the keys that go places: the section hops and the
 * way back to the top.
 *
 * The query lives in memory only: here, and in `ui.searchlight`.
 */
export function Spotlight({
  document,
  slug,
  library = [],
}: {
  document: MarkdownDocument;
  /** The open document, and every document: search goes through all of them. */
  slug?: string;
  library?: readonly Doc[];
}) {
  const [cursor, setCursor] = useState(0);
  const reveal = useRef(false);
  const others = useMemo(() => library.filter((doc) => doc.slug !== slug), [library, slug]);

  return (
    <>
      <SectionHops document={document} />
      <SpotlightDialog
        document={document}
        others={others}
        onLight={(order) => {
          reveal.current = true;
          setCursor(order);
        }}
      />
      <Searchlight document={document} cursor={cursor} setCursor={setCursor} reveal={reveal} />
    </>
  );
}
