import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";

import { fitColumns, imageToAscii } from "#/lib/ascii-art";
import type { AsciiFont } from "#/lib/ascii-art";
import { centreOf, planStorm, stormFrame } from "#/lib/glyph-storm";
import type { StormKind, StormOrigin } from "#/lib/glyph-storm";
import { prefersReducedMotion } from "#/lib/reduced-motion";

/** The characters of the art are never smaller than this, in CSS pixels. */
const MIN_GLYPH = 4.4;

interface AsciiImageProps {
  src: string;
  /**
   * The most characters per line. A narrow box gets fewer, so the characters
   * stay readable.
   */
  columns: number;
  label: string;
  /**
   * Adds a second copy of the art that is drawn only inside a beam. The
   * parent places the beam with `--beam-x` and `--beam-y` (CSS pixels from
   * the top left corner of the art) and shows it with `data-beam`. Styles:
   * `.ascii__lit` in `styles/panel.css`.
   */
  beam?: boolean;
  /**
   * The art decodes out of scrambled characters when it first shows, and a
   * wave of them runs from where the pointer comes in. Not with less motion.
   * See `lib/glyph-storm.ts`; styles: `.ascii__spark` in `styles/panel.css`.
   */
  storm?: boolean;
}

/** A pointer that comes back sooner than this after a wave starts none. */
const STORM_REST_MS = 1400;

/**
 * Runs glyph storms on the art in `pre`. The text nodes React rendered are
 * written directly, once per frame, and hold `art` again when a wave ends.
 * React writes them only when `art` changes, and a new `art` stops the wave.
 */
function useGlyphStorm(
  ref: RefObject<HTMLPreElement | null>,
  art: string,
  image: HTMLImageElement | null,
  on: boolean,
) {
  /** The image whose art has already decoded once: a resize does not decode it again. */
  const revealed = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const pre = ref.current;
    if (!on || !pre || !art || !image) return;

    const base = pre.firstChild instanceof Text ? pre.firstChild : null;
    const lit = pre.querySelector(".ascii__lit")?.firstChild;
    const spark = pre.querySelector<HTMLElement>(".ascii__spark");
    if (!base || !spark) return;

    const plan = planStorm(art);
    let frame = 0;
    let restUntil = 0;
    /** The last text this hook wrote, to tell it from a text React wrote. */
    let painted = art;

    const paint = (text: string, sparks: string) => {
      painted = text;
      base.data = text;
      if (lit instanceof Text) lit.data = text;
      spark.textContent = sparks;
    };

    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      delete pre.dataset.storm;
    };

    const start = (kind: StormKind, origin: StormOrigin) => {
      if (prefersReducedMotion()) return;
      stop();
      restUntil = performance.now() + STORM_REST_MS;
      pre.dataset.storm = kind;
      let started = -1;
      const step = (now: number) => {
        // A tab in the background has no frames: the wave starts when it shows.
        if (started < 0) started = now;
        const next = stormFrame(plan, kind, origin, now - started);
        paint(next.base, next.spark);
        if (next.done) stop();
        else frame = requestAnimationFrame(step);
      };
      // The first frame is painted now, so the art never flashes in full.
      step(performance.now());
    };

    if (revealed.current !== image) {
      revealed.current = image;
      start("reveal", centreOf(plan));
    }

    const onEnter = (event: PointerEvent) => {
      if (frame || performance.now() < restUntil) return;
      const box = pre.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      start("ripple", {
        column: ((event.clientX - box.left) / box.width) * plan.columns,
        row: ((event.clientY - box.top) / box.height) * plan.rows,
      });
    };

    const listeners = new AbortController();
    pre.addEventListener("pointerenter", onEnter, { signal: listeners.signal });

    return () => {
      listeners.abort();
      stop();
      spark.textContent = "";
      // A wave cut short leaves its frame: put the art back. A new art that
      // React has already written is left as it is.
      if (base.data === painted && painted !== art) paint(art, "");
    };
  }, [ref, art, image, on]);
}

/**
 * Resolves when the font the art is shown in can be measured. The art is
 * empty until then, so nothing on the page has asked for the font yet: it is
 * loaded by name first. A font that fails to load is not an error: the
 * fallback font is measured instead.
 */
async function fontReady(family: string, weight: string): Promise<void> {
  try {
    await document.fonts.load(`${weight} 1em ${family}`, "coeas0235689SCOGQ#@%&");
    await document.fonts.ready;
  } catch {
    // Measure with whatever font the browser has.
  }
}

/**
 * Any image, drawn with characters. It fills the width of its parent, which
 * must be a size container (`container-type: inline-size`).
 */
export function AsciiImage({ src, columns, label, beam = false, storm = false }: AsciiImageProps) {
  const ref = useRef<HTMLPreElement>(null);
  const [source, setSource] = useState<{ image: HTMLImageElement; font: AsciiFont } | null>(null);
  /** Characters per line that fit the box now. 0 while the box has no width. */
  const [fit, setFit] = useState(0);

  useEffect(() => {
    const pre = ref.current;
    if (!pre) return;

    let cancelled = false;
    const image = new Image();
    image.src = src;
    // The characters are chosen by their shape in the font the art is shown in.
    const { fontFamily, fontWeight } = getComputedStyle(pre);

    Promise.all([image.decode(), fontReady(fontFamily, fontWeight)]).then(
      () => {
        if (!cancelled) setSource({ image, font: { family: fontFamily, weight: fontWeight } });
      },
      // An image that does not load leaves the art empty; the page still works.
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [src]);

  // The box decides how many characters fit. A hidden box has no width: then
  // nothing is drawn until it shows.
  useEffect(() => {
    const box = ref.current?.parentElement;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => {
      setFit(fitColumns(entry.contentRect.width, columns, MIN_GLYPH));
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [columns]);

  const art = useMemo(
    () => (source && fit > 0 ? imageToAscii(source.image, fit, source.font) : ""),
    [source, fit],
  );

  useGlyphStorm(ref, art, source?.image ?? null, storm);

  return (
    <pre
      ref={ref}
      className="ascii"
      role="img"
      aria-label={label}
      data-ready={art ? "" : undefined}
      style={{ "--columns": fit || columns } as CSSProperties}
    >
      {art}
      {beam && (
        <span className="ascii__lit" aria-hidden="true">
          {art}
        </span>
      )}
      {storm && <span className="ascii__spark" aria-hidden="true" />}
    </pre>
  );
}
