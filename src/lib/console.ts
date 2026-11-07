/**
 * The devtools console: one greeting, and `window.lights` for whoever opens
 * it. Found, not announced.
 *
 * - `lights.off()` / `lights.on()`: lights out on the content page.
 * - `lights.vibe("sodium")`: another light, if it is unlocked.
 *
 * Never prints document text. Started once, on the client, by the root
 * route. The prerendered shell imports this module too: nothing here touches
 * `window` before `startConsole` runs.
 */

import { copy } from "#/lib/copy";
import { getPrefs } from "#/lib/prefs";
import type { Prefs, VibeId } from "#/lib/prefs";
import { closeOverlay, getUi, openOverlay } from "#/lib/ui";
import { VIBES, isUnlocked, setVibe, vibeById } from "#/lib/vibes";

export interface Lights {
  /** Lights out (content page only). */
  off: () => string;
  /** Lights back on (content page only). */
  on: () => string;
  /** Switches to the vibe of that name, if it is unlocked. */
  vibe: (name: string) => string;
}

declare global {
  interface Window {
    /** The console egg: `src/lib/console.ts`. */
    lights?: Lights;
  }
}

const BULB = ['  .-"-.', " /  ~  \\", " \\  |  /", "  |===|", "  '---'"];
/** The text stands to the right of the bulb, on its middle lines. */
const TEXT_COLUMN = 12;

let started = false;

/**
 * What `lights.vibe(name)` does: the vibe to switch to, if any, and what it
 * says. `name` comes from a console: it may be anything.
 */
export function vibeReply(name: unknown, prefs: Prefs): { id?: VibeId; reply: string } {
  const wanted = typeof name === "string" ? name.trim().toLowerCase() : "";
  const vibe = VIBES.find((known) => known.id === wanted);
  if (!vibe) {
    // Only what the reader has: a locked light is found, not listed.
    const names = VIBES.filter((known) => isUnlocked(known.id, prefs)).map((known) => known.id);
    return { reply: copy.eggs.console.unknownVibe(names.join(", ")) };
  }
  if (!isUnlocked(vibe.id, prefs)) return { reply: copy.eggs.console.locked };
  return { id: vibe.id, reply: copy.eggs.console.vibe(vibe.id) };
}

function onContentPage(): boolean {
  // A document: `/content/<slug>`. The library has no lights to put out.
  return /\/content\/[^/]+$/.test(window.location.pathname.replace(/\/+$/, ""));
}

const lights: Lights = {
  off() {
    if (!onContentPage()) return copy.eggs.console.noCurtain;
    openOverlay("curtain");
    return copy.eggs.console.off;
  },
  on() {
    if (!onContentPage()) return copy.eggs.console.noCurtain;
    if (getUi().overlay === "curtain") closeOverlay();
    return copy.eggs.console.on;
  },
  vibe(name) {
    const { id, reply } = vibeReply(name, getPrefs());
    // The new light spreads from the middle of the page.
    if (id) setVibe(id, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    return reply;
  },
};

/** The greeting: a small bulb, and the two lines beside it. */
function greeting(): string {
  const text = ["", "", copy.eggs.console.greeting, copy.eggs.console.usage, ""];
  return BULB.map((line, index) =>
    text[index] ? `${line.padEnd(TEXT_COLUMN)}${text[index]}` : line,
  ).join("\n");
}

/** Says hello in the console once, in the colour of the light, and sets up `window.lights`. */
export function startConsole(): void {
  if (typeof window === "undefined" || started) return;
  started = true;
  window.lights = lights;

  const ink =
    getComputedStyle(window.document.documentElement).getPropertyValue("--accent-ink").trim() ||
    vibeById(getPrefs().vibe).swatch;
  // A dark plate: the light reads on a light console theme too.
  const style = [
    "display:inline-block",
    "padding:10px 16px 10px 10px",
    "border-radius:8px",
    "background:#09090c",
    `color:${ink}`,
    "font:12px/1.35 ui-monospace,Menlo,Consolas,monospace",
  ].join(";");
  console.log(`%c${greeting()}`, style);
}
