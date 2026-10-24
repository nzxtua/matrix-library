import { useEffect, useRef } from "react";

import { copy } from "#/lib/copy";
import { TOOL_KEYS, useHotkeys } from "#/lib/hotkeys";
import type { MarkdownDocument } from "#/lib/markdown";
import { readingLine } from "#/lib/reading";
import { getUi, setRuler, useUi } from "#/lib/ui";

/** Height of the band that follows the pointer, in rem: about three lines of prose. */
const BAND_REM = 5.5;
/** Air between a block and the edges of the band that holds it, in px. */
const PAD = 8;
/** The pointer takes the band back from a block after it moved this far, in px. */
const TAKE_BACK = 6;

/** A block taller than this share of the viewport is stepped line by line. */
const TALL_SHARE = 0.6;

/**
 * What holds the band:
 * - "line": the reading line. Touch devices, and a keyboard before any pointer moved.
 * - "pointer": the pointer y.
 * - "unit": a block (or a row of a tall table), after J or K.
 */
type Mode = "line" | "pointer" | "unit";

/**
 * Which unit J or K goes to. `current` is the unit the band holds, or -1.
 * Without one, `under` is the first unit that ends below the middle of the
 * band, and `inside` says whether the band sits in it: then the step leaves
 * it; else J takes it and K takes the one before.
 */
export function stepIndex(
  count: number,
  direction: 1 | -1,
  current: number,
  under: number,
  inside: boolean,
): number {
  if (count === 0) return -1;
  let next: number;
  if (current !== -1) next = current + direction;
  // The band is below the last unit.
  else if (under === -1) next = count - 1;
  else if (inside) next = under + direction;
  else next = direction === 1 ? under : under - 1;
  return Math.min(count - 1, Math.max(0, next));
}

/** The lines of a tall block: the rows of a table, the items of a list. */
function linesOf(block: HTMLElement): HTMLElement[] {
  const kind = block.dataset.kind;
  let lines: HTMLElement[] = [];
  if (kind === "table") {
    lines = [...block.querySelectorAll<HTMLElement>("tbody > tr")].filter(
      // Not the rows of a table inside a cell.
      (row) => row.parentElement?.closest("td") === null,
    );
  } else if (kind === "list") {
    lines = [...block.querySelectorAll<HTMLElement>(":scope > :is(ul, ol) > li")];
  }
  return lines.filter((line) => line.offsetHeight > 0);
}

/** Everything the band can hold, in the order of the document. */
function unitsOf(root: HTMLElement): HTMLElement[] {
  const tall = window.innerHeight * TALL_SHARE;
  const units: HTMLElement[] = [];
  for (const block of root.querySelectorAll<HTMLElement>(":scope > .doc__block")) {
    const height = block.offsetHeight;
    if (height === 0) continue;
    const lines = height > tall ? linesOf(block) : [];
    if (lines.length > 1) units.push(...lines);
    else units.push(block);
  }
  return units;
}

/**
 * The reading ruler: a band of the page stays lit, everything above and below
 * dims.
 *
 * The band runs over the document column; what stands beside it (the map, the
 * panel) dims as a whole. Two shades are moved with `transform` only. They
 * live in one of two spaces:
 * - the viewport (`data-space="view"`), while the band follows the pointer or
 *   the reading line: the page scrolls under a band that stands still;
 * - the page (`data-space="page"`), while the band holds a block: the shades
 *   scroll with the page by themselves, and nothing is written on scroll.
 *
 * The layer never takes a pointer event: clicks and selection pass through.
 */
export function Ruler(_props: { document: MarkdownDocument }) {
  const on = useUi((state) => state.ruler);

  const layerRef = useRef<HTMLDivElement>(null);
  const aboveRef = useRef<HTMLDivElement>(null);
  const belowRef = useRef<HTMLDivElement>(null);

  const band = useRef({
    mode: "line" as Mode,
    /** The last pointer y in the viewport, or `null` before any pointer moved. */
    pointerY: null as number | null,
    /** Where the pointer was when a block took the band. */
    heldAt: null as { x: number; y: number } | null,
    unit: null as HTMLElement | null,
    frame: 0,
  });
  /** Set while the ruler is on: J and K. */
  const stepper = useRef<((direction: 1 | -1) => void) | null>(null);

  useHotkeys([
    {
      keys: TOOL_KEYS.ruler,
      label: copy.labels.ruler,
      group: "light",
      run: () => setRuler(!getUi().ruler),
    },
    {
      keys: "j",
      label: copy.labels.rulerNext,
      group: "read",
      when: () => getUi().ruler && getUi().overlay === null,
      run: () => stepper.current?.(1),
    },
    {
      keys: "k",
      label: copy.labels.rulerPrevious,
      group: "read",
      when: () => getUi().ruler && getUi().overlay === null,
      run: () => stepper.current?.(-1),
    },
    {
      keys: "escape",
      label: copy.labels.rulerOff,
      group: "light",
      hidden: true,
      // Escape first clears what is lit; only then it puts the ruler away.
      when: () => {
        const ui = getUi();
        return ui.ruler && ui.overlay === null && ui.echo === null && ui.searchlight === null;
      },
      run: () => setRuler(false),
    },
  ]);

  // The last place of the pointer is known before the ruler is switched on,
  // so the band appears under it at once.
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch") band.current.pointerY = event.clientY;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    const above = aboveRef.current;
    const below = belowRef.current;
    const root = window.document.getElementById("doc");
    if (!on || !layer || !above || !below || !root) return;

    const state = band.current;
    state.mode = state.pointerY === null ? "line" : "pointer";
    state.unit = null;
    state.heldAt = null;

    let bandHeight = 0;
    const measure = () => {
      const rem = Number.parseFloat(getComputedStyle(window.document.documentElement).fontSize);
      bandHeight = (Number.isFinite(rem) ? rem : 16) * BAND_REM;
      // The band runs over the document only. What stands beside it dims as a whole.
      const column = root.getBoundingClientRect();
      layer.style.setProperty("--ruler-left", `${Math.max(0, Math.round(column.left))}px`);
      layer.style.setProperty("--ruler-width", `${Math.round(column.width)}px`);
    };

    const mark = (unit: HTMLElement | null) => {
      state.unit?.removeAttribute("data-ruler");
      state.unit = unit;
      // Echo reads this mark: "e" echoes a term of what the ruler holds.
      unit?.setAttribute("data-ruler", "");
    };

    /** Top and bottom of the band, in viewport px. */
    const edges = (): { top: number; bottom: number } => {
      if (state.mode === "unit" && state.unit?.isConnected) {
        const box = state.unit.getBoundingClientRect();
        if (box.height > 0) return { top: box.top - PAD, bottom: box.bottom + PAD };
      }
      if (state.mode === "pointer" && state.pointerY !== null) {
        return { top: state.pointerY - bandHeight / 2, bottom: state.pointerY + bandHeight / 2 };
      }
      // The reading line runs through the first line of the band.
      const top = readingLine() - bandHeight * 0.3;
      return { top, bottom: top + bandHeight };
    };

    const draw = () => {
      state.frame = 0;
      const held = state.mode === "unit" && state.unit?.isConnected === true;
      const space = held ? "page" : "view";
      if (layer.dataset.space !== space) layer.dataset.space = space;

      let { top, bottom } = edges();
      if (held) {
        // In the page: the layer is as tall as the page and scrolls with it.
        const page = layer.parentElement;
        layer.style.height = page ? `${page.offsetTop + page.offsetHeight}px` : "";
        const origin = layer.getBoundingClientRect().top;
        top -= origin;
        bottom -= origin;
      } else {
        layer.style.height = "";
      }

      // Each shade is as tall as the layer. The upper one ends at the band,
      // the lower one starts there.
      above.style.transform = `translate3d(0, calc(${top.toFixed(1)}px - 100%), 0)`;
      below.style.transform = `translate3d(0, ${bottom.toFixed(1)}px, 0)`;
    };

    const schedule = () => {
      if (state.frame === 0) state.frame = requestAnimationFrame(draw);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      if (state.mode === "unit") {
        // A block holds the band until the pointer really moves.
        state.heldAt ??= { x: event.clientX, y: event.clientY };
        const moved = Math.hypot(event.clientX - state.heldAt.x, event.clientY - state.heldAt.y);
        if (moved < TAKE_BACK) return;
        mark(null);
      }
      state.mode = "pointer";
      state.pointerY = event.clientY;
      schedule();
    };

    const onResize = () => {
      measure();
      schedule();
    };

    stepper.current = (direction) => {
      const units = unitsOf(root);
      const { top, bottom } = edges();
      const middle = (top + bottom) / 2;

      const current = state.mode === "unit" && state.unit ? units.indexOf(state.unit) : -1;
      let under = -1;
      let inside = false;
      if (current === -1) {
        under = units.findIndex((unit) => unit.getBoundingClientRect().bottom > middle);
        inside = under !== -1 && units[under].getBoundingClientRect().top <= middle;
      }

      const target = units[stepIndex(units.length, direction, current, under, inside)];
      if (!target) return;

      // Off screen: the page jumps so the block starts at the reading line.
      const box = target.getBoundingClientRect();
      if (box.top - PAD < 0 || box.bottom + PAD > window.innerHeight) {
        target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        window.scrollBy({
          top: target.getBoundingClientRect().top - readingLine(),
          behavior: "instant",
        });
      }

      state.mode = "unit";
      state.heldAt = null;
      mark(target);
      cancelAnimationFrame(state.frame);
      draw();
    };

    measure();
    draw();

    // A filter, an unfolded block or a new text size moves the block the band holds.
    const observer = new ResizeObserver(onResize);
    observer.observe(root);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("resize", onResize);

    return () => {
      observer.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(state.frame);
      state.frame = 0;
      stepper.current = null;
      mark(null);
      layer.style.height = "";
      layer.dataset.space = "view";
    };
  }, [on]);

  return (
    <div
      ref={layerRef}
      className="ruler"
      data-on={on || undefined}
      data-space="view"
      aria-hidden="true"
    >
      <div className="ruler__side ruler__side--left" />
      <div className="ruler__side ruler__side--right" />
      <div ref={aboveRef} className="ruler__shade ruler__shade--above" />
      <div ref={belowRef} className="ruler__shade ruler__shade--below" />
    </div>
  );
}
