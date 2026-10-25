/**
 * The vibes: four light sources. A vibe colours structure only (chips, rails,
 * focus, marks) and the rain. Body ink is neutral in every vibe.
 *
 * The CSS half of a vibe is in `styles/tokens.css` (`html[data-vibe="…"]`).
 * The two must agree.
 *
 * This module must stay free of content imports: the Enter page uses it.
 */

import { copy } from "#/lib/copy";
import { getPrefs, setPrefs, usePrefs } from "#/lib/prefs";
import type { Prefs, VibeId } from "#/lib/prefs";
import { prefersReducedMotion } from "#/lib/reduced-motion";

/** One ink of the rain: the glyph colour and the colour of its glow. */
export interface Ink {
  fill: string;
  glow: string;
}

export interface RainPalette {
  /** The falling streams. */
  trail: Ink;
  /** The first glyph of a stream. */
  head: Ink;
  /** The second ink: every few streams use it. */
  alt: Ink;
  /** Glyphs in the soft edge of the beam. */
  fringe: Ink;
  /** RGB of the lit disc at the centre of the beam. */
  haze: [number, number, number];
  /** RGB of the lit disc toward its edge. */
  hazeEdge: [number, number, number];
}

export interface Vibe {
  id: VibeId;
  label: string;
  note: string;
  /** `<meta name="theme-color">`: the dark, with a trace of this light. */
  themeColor: string;
  /** CSS colour of the dot that stands for this vibe. */
  swatch: string;
  rain: RainPalette;
}

/** The reader must find this many objects on the Enter page to unlock `cryo`. */
export const FOUND_TOTAL = 3;

export const VIBES: Vibe[] = [
  {
    id: "ultraviolet",
    ...copy.vibes.ultraviolet,
    themeColor: "#0a0612",
    swatch: "rgb(204 255 0)",
    rain: {
      trail: { fill: "#c3f411", glow: "#ccff00" },
      head: { fill: "#f8ffdc", glow: "#e4ff70" },
      alt: { fill: "#ff5fe2", glow: "#ff3ddb" },
      fringe: { fill: "#a655ff", glow: "#8f00ff" },
      haze: [176, 96, 255],
      hazeEdge: [143, 0, 255],
    },
  },
  {
    id: "phosphor",
    ...copy.vibes.phosphor,
    themeColor: "#020b06",
    swatch: "rgb(0 255 102)",
    rain: {
      // Exactly the greens the rain had before there were vibes.
      trail: { fill: "#19f26b", glow: "#00ff66" },
      head: { fill: "#e6fff0", glow: "#8dffbb" },
      alt: { fill: "#8dffbb", glow: "#00ff66" },
      fringe: { fill: "#19f26b", glow: "#00ff66" },
      haze: [140, 255, 185],
      hazeEdge: [0, 255, 102],
    },
  },
  {
    id: "sodium",
    ...copy.vibes.sodium,
    themeColor: "#0e0902",
    swatch: "rgb(255 176 0)",
    rain: {
      trail: { fill: "#ffb81f", glow: "#ffb000" },
      head: { fill: "#fff4dc", glow: "#ffd480" },
      alt: { fill: "#ff7350", glow: "#ff5e3a" },
      fringe: { fill: "#f0641a", glow: "#ff8c00" },
      haze: [255, 196, 110],
      hazeEdge: [255, 140, 0],
    },
  },
  {
    id: "cryo",
    ...copy.vibes.cryo,
    themeColor: "#030a10",
    swatch: "rgb(120 230 255)",
    rain: {
      trail: { fill: "#70e2ff", glow: "#78e6ff" },
      head: { fill: "#edfbff", glow: "#b8f2ff" },
      alt: { fill: "#b09bfb", glow: "#a78bfa" },
      fringe: { fill: "#2ea4ff", glow: "#00aaff" },
      haze: [160, 228, 255],
      hazeEdge: [0, 170, 255],
    },
  },
];

export function vibeById(id: VibeId): Vibe {
  return VIBES.find((vibe) => vibe.id === id) ?? VIBES[0];
}

/** `cryo` is found, not given: it needs every object of the Enter page. */
export function isUnlocked(id: VibeId, prefs: Prefs): boolean {
  return id !== "cryo" || new Set(prefs.found).size >= FOUND_TOTAL;
}

export function useVibe(): Vibe {
  return vibeById(usePrefs((prefs) => prefs.vibe));
}

/** How long the new light takes to cover the page. Matches `tokens.css`. */
const REVEAL_MS = 620;

/**
 * Switches the vibe. A locked vibe is ignored.
 *
 * With an origin (viewport CSS pixels), the new light spreads as a circle
 * from it (View Transitions; a plain cut without them or with calm motion).
 */
export function setVibe(id: VibeId, origin?: { x: number; y: number }): void {
  const prefs = getPrefs();
  if (id === prefs.vibe || !isUnlocked(id, prefs)) return;

  const apply = () => setPrefs({ vibe: id });
  if (
    !origin ||
    typeof document === "undefined" ||
    typeof document.startViewTransition !== "function" ||
    prefersReducedMotion()
  ) {
    apply();
    return;
  }

  const root = document.documentElement;
  const { innerWidth, innerHeight } = window;
  // The circle must reach the farthest corner of the viewport.
  const radius = Math.hypot(
    Math.max(origin.x, innerWidth - origin.x),
    Math.max(origin.y, innerHeight - origin.y),
  );
  root.style.setProperty("--vt-x", `${origin.x}px`);
  root.style.setProperty("--vt-y", `${origin.y}px`);
  root.style.setProperty("--vt-r", `${Math.ceil(radius)}px`);
  root.style.setProperty("--vt-ms", `${REVEAL_MS}ms`);
  root.dataset.vt = "vibe";

  const done = () => {
    delete root.dataset.vt;
    for (const name of ["--vt-x", "--vt-y", "--vt-r", "--vt-ms"]) root.style.removeProperty(name);
  };

  try {
    // `setPrefs` writes `data-vibe` on <html> at once: the new look is in
    // place when this callback returns.
    document.startViewTransition(apply).finished.then(done, done);
  } catch {
    done();
    apply();
  }
}
