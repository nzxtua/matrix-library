import { useEffect } from "react";
import type { RefObject } from "react";

import { prefersReducedMotion } from "#/lib/reduced-motion";

/** The first character starts to settle after this long. */
const FIRST_MS = 160;
/** The settle wave runs from the first character to the last in this long. */
const SPREAD_MS = 420;
/** Each character settles up to this much later than its place in the wave. */
const JITTER_MS = 140;
/** The noise changes this often: faster reads as a blur, not as letters. */
const NOISE_MS = 48;
/** The heading decodes when it is this far above the bottom of the view. */
const ROOT_MARGIN = "0px 0px -18% 0px";
/** A heading in full view that never reaches that line decodes after this long. */
const FALLBACK_MS = 500;

const UPPER = "ABCDEFGHJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghjkmnopqrstuvwxyz";
const DIGITS = "0123456789";

function pick(set: string, random: () => number): string {
  return set[Math.floor(random() * set.length)];
}

/**
 * A noise glyph of the same kind as `char`: a capital for a capital, a digit
 * for a digit. Anything that is not a letter or a digit (a space, "&", "?")
 * stays as it is, so words and punctuation keep their shape.
 */
export function noiseFor(char: string, random: () => number = Math.random): string {
  if (/[0-9]/.test(char)) return pick(DIGITS, random);
  if (char !== char.toUpperCase()) return pick(LOWER, random);
  if (char !== char.toLowerCase()) return pick(UPPER, random);
  return char;
}

/**
 * When each character of a text of `length` settles, in ms from the start: a
 * wave from left to right with some jitter, so the letters do not lock in a
 * strict row. The last one settles by `FIRST_MS + SPREAD_MS + JITTER_MS`.
 */
export function settleTimes(length: number, random: () => number = Math.random): number[] {
  const step = length > 1 ? SPREAD_MS / (length - 1) : 0;
  return Array.from({ length }, (_, index) => FIRST_MS + index * step + random() * JITTER_MS);
}

/** The whole decode takes at most this long. */
export const DECODE_MS = FIRST_MS + SPREAD_MS + JITTER_MS;

/**
 * One frame of `text` at `elapsed` ms: a character whose time in `settleAt`
 * has come shows itself, the rest show noise of their kind. The frame is
 * always as long as the text.
 */
export function decodeFrame(
  text: string,
  elapsed: number,
  settleAt: number[],
  random: () => number = Math.random,
): string {
  let frame = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    frame += elapsed >= settleAt[index] ? char : noiseFor(char, random);
  }
  return frame;
}

/** The text nodes under `root`, in reading order. */
function textNodes(root: Element): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

/**
 * How long until the block around `element` comes into the light: the first
 * blocks of the page fade in after a delay, and a decode under that delay
 * would play unseen.
 */
function untilShown(element: Element): number {
  const block = element.closest(".doc__block");
  if (!block || typeof block.getAnimations !== "function") return 0;
  for (const animation of block.getAnimations()) {
    const delay = Number(animation.effect?.getTiming().delay ?? 0);
    const time = Number(animation.currentTime ?? 0);
    if (animation.playState === "running" && time < delay) return delay - time;
  }
  return 0;
}

/**
 * The text of `ref` waits as noise until the element scrolls into view, then
 * decodes: the characters settle in a wave from left to right. It plays once.
 *
 * It writes the text nodes in place, so the markup inside (a `<strong>`, a
 * `<code>`) keeps its style. The element shows its state in `data-decode`:
 * "pending", "running", then "done". The caller gives the element an
 * `aria-label` with the real text, because a screen reader can reach it while
 * it is still noise. Printing settles every heading at once. Nothing moves
 * with reduced motion.
 */
export function useDecodeOnView(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || prefersReducedMotion() || typeof IntersectionObserver === "undefined") return;

    const nodes = textNodes(element);
    const parts = nodes.map((node) => node.data);
    const text = parts.join("");
    const settleAt = settleTimes(text.length);

    /** Writes a frame back across the text nodes, each its own slice. */
    const paint = (frame: string) => {
      let at = 0;
      nodes.forEach((node, index) => {
        const next = frame.slice(at, at + parts[index].length);
        at += parts[index].length;
        if (node.data !== next) node.data = next;
      });
    };

    let frameId = 0;
    let delayId = 0;

    const settle = () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(delayId);
      paint(text);
      element.dataset.decode = "done";
    };

    const run = () => {
      element.dataset.decode = "running";
      let start = 0;
      let lastNoise = -Infinity;
      const tick = (now: number) => {
        start ||= now;
        const elapsed = now - start;
        if (elapsed >= DECODE_MS) return settle();
        // The noise changes on its own beat; a settled letter shows at once.
        if (now - lastNoise >= NOISE_MS) {
          lastNoise = now;
          paint(decodeFrame(text, elapsed, settleAt));
        }
        frameId = window.requestAnimationFrame(tick);
      };
      frameId = window.requestAnimationFrame(tick);
    };

    element.dataset.decode = "pending";
    paint(decodeFrame(text, 0, settleAt));

    let fallbackId = 0;
    const begin = () => {
      line.disconnect();
      whole.disconnect();
      window.clearTimeout(fallbackId);
      delayId = window.setTimeout(run, untilShown(element));
    };

    // It decodes when it crosses the reading line, well inside the view.
    const line = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) begin();
      },
      { rootMargin: ROOT_MARGIN },
    );
    // A heading at the end of the page may never reach that line: once it is
    // in full view and stays there for a beat, it decodes anyway.
    const whole = new IntersectionObserver(
      ([entry]) => {
        window.clearTimeout(fallbackId);
        if (entry?.isIntersecting) fallbackId = window.setTimeout(begin, FALLBACK_MS);
      },
      { threshold: 1 },
    );
    line.observe(element);
    whole.observe(element);

    const onPrint = () => {
      line.disconnect();
      whole.disconnect();
      window.clearTimeout(fallbackId);
      settle();
    };
    window.addEventListener("beforeprint", onPrint);

    return () => {
      line.disconnect();
      whole.disconnect();
      window.clearTimeout(fallbackId);
      window.removeEventListener("beforeprint", onPrint);
      settle();
      delete element.dataset.decode;
    };
  }, [ref]);
}
