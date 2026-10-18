import { useEffect, useRef, useState } from "react";

import { prefersReducedMotion } from "#/lib/reduced-motion";

const TICK_MS = 42;
/** Any text settles in this many ticks, whatever its length. */
const TICKS = 14;

/**
 * Capitals and digits only: the label is set in the display face, and a glyph
 * the face does not have would fall back to another font and change the slot.
 */
const NOISE = "ABCDEFGHJKLMNOPQRSTUVWXYZ0123456789";

function randomCapital(): string {
  return NOISE[Math.floor(Math.random() * NOISE.length)];
}

/**
 * One frame of a text that decodes left to right: `progress` (0..1) of it has
 * settled, the rest is noise from `glyph`. Spaces stay, so words keep their
 * shape while they decode. The frame is always as long as the text.
 */
export function scrambleFrame(
  text: string,
  progress: number,
  glyph: () => string = randomCapital,
): string {
  const settled = Math.floor(Math.min(1, Math.max(0, progress)) * text.length);
  const noise = Array.from(text.slice(settled), (char) => (char === " " ? " " : glyph()));
  return text.slice(0, settled) + noise.join("");
}

/**
 * Shows `text`. When the text changes, the new one arrives as noise that
 * settles left to right. Nothing moves on the first render, and nothing
 * moves with reduced motion: the text is swapped.
 */
export function useScramble(text: string): string {
  const [output, setOutput] = useState(text);
  const shown = useRef(text);

  useEffect(() => {
    if (shown.current === text) return;
    shown.current = text;

    if (prefersReducedMotion()) {
      setOutput(text);
      return;
    }

    let tick = 0;
    const timer = window.setInterval(() => {
      tick += 1;
      if (tick >= TICKS) window.clearInterval(timer);
      setOutput(scrambleFrame(text, tick / TICKS));
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, [text]);

  return output;
}
