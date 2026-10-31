import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, KeyboardEvent, MouseEvent } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";

import { Moth } from "#/components/Moth";
import type { MothHandle } from "#/components/Moth";
import { copy } from "#/lib/copy";
import { useHotkeys } from "#/lib/hotkeys";
import type { Hotkey } from "#/lib/hotkeys";
import { ping } from "#/lib/jump";
import { clamp } from "#/lib/math";
import {
  MAX_SCALE,
  MIN_SCALE,
  afterglow,
  beamFalloff,
  createFlashlight,
  morse,
  outage,
} from "#/lib/matrix-flashlight";
import type { Flashlight, Light } from "#/lib/matrix-flashlight";
import type { Deep } from "#/lib/deep-rain";
import { codeTiles, FAR_EM, NEAR_EM, revokeTiles } from "#/lib/code-tiles";
import type { CodeTiles } from "#/lib/code-tiles";
import { getPrefs, setPrefs, usePrefs } from "#/lib/prefs";
import type { VibeId } from "#/lib/prefs";
import { prefersReducedMotion } from "#/lib/reduced-motion";
import { entrySlug } from "#/lib/shelf";
import { wordmark } from "#/lib/site";
import { useScramble } from "#/lib/use-scramble";
import { FOUND_TOTAL, VIBES, isUnlocked, setVibe, useVibe, vibeById } from "#/lib/vibes";
import type { Vibe } from "#/lib/vibes";

/**
 * idle → (click) → flooding: the light spreads over the viewport
 *      → loading: the document is fetched behind the fill of the pill
 *      → done: the fill is complete → the content page opens.
 */
type Phase = "idle" | "flooding" | "loading" | "done";

/**
 * How long the show lasts at least, in ms: the flood, the loading, the last
 * stretch of the fill, and a beat on "lights on".
 */
interface Show {
  flood: number;
  load: number;
  finish: number;
  hold: number;
}

const FULL_SHOW: Show = { flood: 1700, load: 3400, finish: 240, hold: 360 };
/** A returning reader has seen it: about half the time, still long enough to fall. */
const FAST_LANE: Show = { flood: 800, load: 1400, finish: 160, hold: 200 };

/** The fill waits here until the document has really loaded. */
const HONEST_LIMIT = 0.85;

/** The beam rests on the pill this long before the label asks. */
const NAG_MS = 10_000;
/** A message next to a found object stays this long. */
const NOTE_MS = 2800;

const NUDGE = 48;
const NUDGE_FAR = 160;
/** An object can be collected when at least this much light reaches it. */
const COLLECT_LIT = 0.25;

type HintKind = "pointer" | "touch" | "keys";

const HINTS: Record<HintKind, string> = {
  pointer: copy.enter.hintPointer,
  touch: copy.enter.hintTouch,
  keys: copy.enter.hintKeys,
};

/*
 * Easter eggs. Found, not announced, and never in the way of entering.
 */

/** A reader who read the whole document: the letters keep this much light in the dark. */
const INK_REMEMBERS = 0.15;
/** Clicks on nothing, this many within this time, and the battery gives out. */
const BURST_CLICKS = 6;
const BURST_MS = 2000;
/** "and we're back." or "swapped the battery." stays this long after the light is back. */
const STATUS_MS = 2400;
/** Between midnight and 5 am the first hint is the night one, for this long. */
const NIGHT_UNTIL_HOUR = 5;
const NIGHT_MS = 9000;
/** Nobody touched anything for this long: the sweeping beam signals once. */
const SOS_IDLE_MS = 45_000;
const SOS = "... --- ...";
/** A Morse unit in seconds (a dot), and the power between the marks: low, never dark. */
const SOS_UNIT = 0.2;
const SOS_LOW = 0.15;
/** The SOS plays once per page load, not once per visit to this route. */
let sosSent = false;

/**
 * Clicks on nothing, newest last. Returns the clicks to keep and whether they
 * made a burst: `BURST_CLICKS` within `BURST_MS`. A burst starts the count over.
 */
export function clickBurst(
  times: readonly number[],
  now: number,
): { times: number[]; burst: boolean } {
  const recent = [...times.filter((time) => now - time < BURST_MS), now];
  return recent.length >= BURST_CLICKS
    ? { times: [], burst: true }
    : { times: recent, burst: false };
}

/** A long hint wraps between its parts, never inside one ("1–4"): parts, or sentences. */
function hintParts(text: string): { parts: string[]; joint: string } {
  const parts = text.split(" · ");
  return parts.length > 1
    ? { parts, joint: " · " }
    : { parts: text.split(/(?<=\.)\s+/), joint: " " };
}

/**
 * Three things pinned in the dark. Each is a small drawing in the mono face,
 * as it hangs there and as it looks once found. Both drawings of one object
 * have the same size, so nothing moves when it is found.
 * Their names live in `copy.enter.objects`.
 */
const OBJECTS = [
  {
    id: "moth",
    dark: [" __   __ ", "(  \\,/  )", " \\_ | _/ ", " (_/ \\_) "],
    // Found, the moth leaves its pin and flies to the light (`Moth.tsx`).
    found: ["         ", "    .    ", "         ", "         "],
  },
  {
    id: "switch",
    dark: [".-----.", "| .-. |", "| | | |", "| |#| |", "| '-' |", "'-----'"],
    found: [".-----.", "| .-. |", "| |#| |", "| | | |", "| '-' |", "'-----'"],
  },
  {
    id: "battery",
    dark: [".---------. ", "| +       |]", "'---------' "],
    found: [".---------. ", "| + ||||| |]", "'---------' "],
  },
] as const;

type ObjectId = (typeof OBJECTS)[number]["id"];

/** One element that exists only in the light, with its box in the viewport. */
interface Target {
  element: HTMLElement;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** A letter of the wordmark: lit by its centre, and its ink glows after. */
  ink: boolean;
  /** The light of the ink, afterglow included, before rounding. */
  glow: number;
  /** The value of `--lit` that the element has now; -1 before the first write. */
  shown: number;
  /** A letter: its faces (depth, ink, code), its own character, and its decoding. */
  letter?: LetterState;
}

/** What a letter of the wordmark keeps between frames. */
interface LetterState {
  faces: HTMLElement[];
  char: string;
  /** It has been dark since it last decoded: the next light decodes it again. */
  dark: boolean;
  /** When the decoding ends (ms); 0 when it is not decoding. */
  until: number;
  /** When the faces last changed character during a decoding. */
  flipped: number;
  /** The tilt written last, in degrees. */
  rx: number;
  ry: number;
}

/** Copies of a letter behind it, each a step further back: its depth. */
const DEPTHS = [1, 2, 3];
/** How far a letter turns to the light at most, in degrees: about its upright axis, and its level one. */
const TURN_Y = 28;
const TURN_X = 18;
/** A letter that comes out of the dark decodes for this long (ms), a new character every FLIP_MS. */
const DECODE_MS = 520;
const FLIP_MS = 55;
const SCRAMBLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
/** The code inside the letters falls this many em per second, near and far. */
const FALL_NEAR = 1.25;
const FALL_FAR = 0.6;
/** ENTER under the pointer: time in the rain slows to this. */
const HOVER_PACE = 0.18;

/** How much of the beam reaches the nearest point of a box: 0..1. */
function litBy(target: Target, light: Light): number {
  const dx = Math.max(target.left - light.x, 0, light.x - target.right);
  const dy = Math.max(target.top - light.y, 0, light.y - target.bottom);
  return light.power * beamFalloff(Math.hypot(dx, dy), light.radius);
}

function centreOf(element: Element): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/** The code tiles of a row, as the CSS the letters read. */
function codeStyle(tiles: CodeTiles | null | undefined): CSSProperties | undefined {
  if (!tiles) return undefined;
  return {
    "--code-near": `url("${tiles.near}")`,
    "--code-far": `url("${tiles.far}")`,
  } as CSSProperties;
}

/**
 * A letter in the light: it turns to face the beam, as far as it is lit, and
 * a letter that comes out of the dark decodes: its faces run through other
 * characters before they settle on its own.
 */
function shapeLetter(
  letter: LetterState,
  target: Target,
  light: Light,
  reach: number,
  now: number,
  calm: boolean,
) {
  // Turn: toward where the light is, in units of the beam's radius.
  const radius = Math.max(light.radius, 1);
  const dx = clamp((light.x - target.left) / radius, -1, 1);
  const dy = clamp((light.y - target.top) / radius, -1, 1);
  const turn = calm ? 0 : target.glow;
  const ry = Math.round(dx * TURN_Y * turn * 10) / 10;
  const rx = Math.round(-dy * TURN_X * turn * 10) / 10;
  if (
    Math.abs(ry - letter.ry) >= 0.2 ||
    Math.abs(rx - letter.rx) >= 0.2 ||
    (turn === 0 && (letter.rx || letter.ry))
  ) {
    letter.rx = turn === 0 ? 0 : rx;
    letter.ry = turn === 0 ? 0 : ry;
    target.element.style.setProperty("--rx", `${letter.rx}deg`);
    target.element.style.setProperty("--ry", `${letter.ry}deg`);
  }

  // Decode: out of the dark into the core of the beam.
  if (target.glow < 0.06) letter.dark = true;
  if (!calm && letter.dark && reach >= 0.55) {
    letter.dark = false;
    letter.until = now + DECODE_MS;
  }
  if (letter.until === 0) return;
  if (now >= letter.until) {
    letter.until = 0;
    for (const face of letter.faces) face.textContent = letter.char;
    return;
  }
  if (now - letter.flipped < FLIP_MS) return;
  letter.flipped = now;
  const char = SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)] ?? letter.char;
  for (const face of letter.faces) face.textContent = char;
}

/** Room between two letters of the wordmark at full light, in em. */
const LETTER_GAP = 0.16;
/** A wordmark row of this many letters or fewer is set in the wide axes. */
const WIDE_LETTERS = 4;
/** Width of a space between two words of one row, in em (see enter.css). */
const SPACE_EMS = 0.3;

/**
 * Gives every letter of the wordmark a slot as wide as the letter at full
 * light, plus a gap. The slots are fixed: a letter swells inside its own slot
 * and never moves its neighbours, and at full light the spacing is even.
 * Runs when the face arrives and when the stage changes shape (the axes of
 * an upright stage are not the same).
 */
function fitSlots(stage: HTMLElement) {
  for (const row of stage.querySelectorAll<HTMLElement>(".wordmark__row")) {
    // The row's width in em at full light: the sum of its slots.
    let ems = 0;
    for (const letter of row.querySelectorAll<HTMLElement>(".wordmark__letter")) {
      const before = letter.style.getPropertyValue("--lit");
      letter.style.setProperty("--lit", "1");
      // The ink face, as laid out: tilt and depth are transforms, not layout.
      const ink = letter.querySelector<HTMLElement>(".wordmark__ink") ?? letter;
      const width = Number.parseFloat(getComputedStyle(ink).width) || 0;
      const size = Number.parseFloat(getComputedStyle(letter).fontSize) || 1;
      letter.style.setProperty("--lit", before);
      if (width <= 0) continue;
      const slot = width / size + LETTER_GAP;
      letter.style.flexGrow = String(slot);
      ems += slot;
    }
    ems += row.querySelectorAll(".wordmark__space").length * SPACE_EMS;
    // A word too long for the block gets smaller letters; a short one keeps
    // the full size (the block is sized for about 3.4em).
    row.style.setProperty("--row-ems", ems > 0 ? ems.toFixed(3) : "");
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 2;
}

function startsCoarse(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

/** The label of the pill: one fixed slot per letter, so nothing shifts. */
function Slots({ text }: { text: string }) {
  return (
    <span className="enter__label">
      {Array.from(text, (char, index) => (
        <span key={index} className="enter__char">
          {char}
        </span>
      ))}
    </span>
  );
}

export function MatrixFlashlight() {
  const stageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** The Three.js layer under the wordmark: deep rain, the shaft, the dive. */
  const deepCanvasRef = useRef<HTMLCanvasElement>(null);
  const deepRef = useRef<Deep | null>(null);
  const [deepReady, setDeepReady] = useState(false);
  const wordmarkRef = useRef<HTMLDivElement>(null);
  /** The code inside the letters: tiles for the first row's ink and the second's. */
  const [tiles, setTiles] = useState<(CodeTiles | null)[]>([null, null]);
  const pillRef = useRef<HTMLButtonElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const dotsRef = useRef<HTMLDivElement>(null);
  const flashlightRef = useRef<Flashlight | null>(null);

  /** Everything with `data-lit`, measured. Read every frame by `onLight`. */
  const targetsRef = useRef<Target[]>([]);
  const measureRef = useRef<() => void>(() => {});

  const router = useRouter();
  const navigate = useNavigate();

  const [phase, setPhaseState] = useState<Phase>("idle");
  /** The same phase for code that runs outside of a render: frames, keys. */
  const phaseRef = useRef<Phase>("idle");
  const setPhase = (next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  };
  const showRef = useRef<Show>(FULL_SHOW);
  const [fast, setFast] = useState(false);
  const loadedRef = useRef(false);
  const goneRef = useRef(false);

  const [nag, setNag] = useState(false);
  const nagRef = useRef(false);

  const [hint, setHintState] = useState<HintKind>(() => (startsCoarse() ? "touch" : "pointer"));
  const hintRef = useRef(hint);

  /** The vibe under the pointer or the focus; its name shows instead of the current one. */
  const [peek, setPeek] = useState<VibeId | null>(null);
  const peekTimer = useRef(0);
  /** What a found object says for a moment. */
  const [note, setNote] = useState<{ id: ObjectId; text: string } | null>(null);
  /** The third object was found during this visit. */
  const [unlockedNow, setUnlockedNow] = useState(false);

  /** What the flashlight says where the hint lives: the battery. */
  const [status, setStatus] = useState<string | null>(null);
  const statusTimer = useRef(0);
  /** The battery is out or coming back: clicks do not count. */
  const batteryRef = useRef(false);
  /** Recent clicks on nothing, for the dead battery. */
  const clicksRef = useRef<number[]>([]);
  /** Between midnight and 5 am the first hint is the night one. The page renders in the browser only. */
  const [night, setNight] = useState(() => new Date().getHours() < NIGHT_UNTIL_HOUR);
  /** The last input of any kind, for the SOS. */
  const lastInputRef = useRef(0);
  /** The SOS is on the air. */
  const sosRef = useRef(false);
  /** The floor of light of the wordmark letters. Read every frame. */
  const floorRef = useRef(0);
  const mothRef = useRef<MothHandle>(null);
  /** Where the moth was found during this visit: it flies from there. */
  const [mothFrom, setMothFrom] = useState<{ x: number; y: number } | null>(null);

  const vibe = useVibe();
  const prefs = usePrefs((p) => ({
    seen: p.seen,
    found: p.found,
    percent: p.percent,
    last: p.last,
  }));
  const cryoOpen = isUnlocked("cryo", getPrefs());
  const foundCount = OBJECTS.filter((object) => prefs.found.includes(object.id)).length;
  const hasMoth = prefs.found.includes("moth");
  /** Every room of the document was lit: the ink remembers. */
  const allRead = prefs.percent >= 100;

  const label = useScramble(nag && phase === "idle" ? copy.enter.nag : copy.enter.label);
  const entered = phase !== "idle";
  /** A reader who was inside before and read something can go straight back. */
  const canContinue = !entered && prefs.seen && (prefs.percent > 0 || prefs.last !== null);

  // The engine, and the blacklight layer: every `[data-lit]` element gets its
  // own `--lit` from the beam, written on that element only.
  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    const measure = () => {
      const before = new Map(targetsRef.current.map((target) => [target.element, target]));
      targetsRef.current = Array.from(
        stage.querySelectorAll<HTMLElement>("[data-lit]"),
        (element) => {
          const box = element.getBoundingClientRect();
          // A letter of the wordmark is lit as much as its centre: the beam
          // then picks out single letters. A control is lit as much as the
          // nearest point of its box.
          const point = element.dataset.lit === "centre";
          const x = box.left + box.width / 2;
          const y = box.top + box.height / 2;
          const known = before.get(element);
          return {
            element,
            left: point ? x : box.left,
            top: point ? y : box.top,
            right: point ? x : box.right,
            bottom: point ? y : box.bottom,
            ink: point,
            glow: known?.glow ?? 0,
            shown: known?.shown ?? -1,
            letter: point
              ? (known?.letter ?? {
                  faces: Array.from(
                    element.querySelectorAll<HTMLElement>(".wordmark__body > span"),
                  ),
                  char: element.dataset.char ?? "",
                  dark: true,
                  until: 0,
                  flipped: 0,
                  rx: 0,
                  ry: 0,
                })
              : undefined,
          };
        },
      );
    };
    measureRef.current = measure;
    measure();

    /** When the beam came to rest on the pill; 0 while it is elsewhere. */
    let restingSince = 0;
    /** When the last frame was reported, for the afterglow. */
    let lastFrame = 0;
    /** Seconds of rain the code inside the letters has fallen. */
    let fall = 0;

    const flashlight = createFlashlight(canvas, {
      // The beam takes the vibe.
      palette: vibeById(getPrefs().vibe).rain,
      sweep: true,
      onLight(light) {
        const pill = pillRef.current;
        let pillLit = 0;
        const now = performance.now();
        const dt = lastFrame === 0 ? 0 : Math.min(0.1, (now - lastFrame) / 1000);
        lastFrame = now;
        const calm = prefersReducedMotion();
        const floor = floorRef.current;

        for (const target of targetsRef.current) {
          const reach = litBy(target, light);
          let lit = reach;
          if (target.ink) {
            // The letters are phosphorescent ink: the beam leaves a trail
            // that fades. With less motion the light simply leaves.
            target.glow = calm ? reach : afterglow(target.glow, reach, dt);
            lit = Math.max(floor, target.glow);
            if (target.letter) shapeLetter(target.letter, target, light, reach, now, calm);
          }
          lit = Math.round(lit * 1000) / 1000;
          if (target.element === pill) pillLit = lit;
          if (lit === target.shown) continue;
          // Small changes are skipped, but the ends are always reached: off
          // must be exactly off (or exactly the floor the ink keeps).
          const end = lit === 0 || lit === 1 || (target.ink && lit === floor);
          if (Math.abs(lit - target.shown) < 0.004 && !end) continue;
          target.shown = lit;
          target.element.style.setProperty("--lit", String(lit));
        }

        mothRef.current?.update(light);
        deepRef.current?.frame(light);

        // The code inside the letters falls, at the pace of the rain.
        const wordmarkEl = wordmarkRef.current;
        if (wordmarkEl && !calm) {
          fall += dt * light.pace;
          wordmarkEl.style.setProperty(
            "--fall-near",
            `${((fall * FALL_NEAR) % NEAR_EM.height).toFixed(3)}em`,
          );
          wordmarkEl.style.setProperty(
            "--fall-far",
            `${((fall * FALL_FAR) % FAR_EM.height).toFixed(3)}em`,
          );
        }

        // Nobody has touched anything for a long while and the beam sweeps
        // on its own: it signals, once.
        if (
          !sosSent &&
          !calm &&
          phaseRef.current === "idle" &&
          !batteryRef.current &&
          now - lastInputRef.current >= SOS_IDLE_MS &&
          flashlightRef.current?.isSweeping()
        ) {
          sosSent = true;
          sosRef.current = true;
          flashlightRef.current.signal(morse(SOS, SOS_UNIT, SOS_LOW), {
            onEnd: () => {
              sosRef.current = false;
            },
          });
        }

        // The beam rests on the pill and nothing happens: the label asks.
        if (phaseRef.current === "idle" && pillLit >= 0.85) {
          if (restingSince === 0) restingSince = now;
          if (!nagRef.current && now - restingSince >= NAG_MS) {
            nagRef.current = true;
            setNag(true);
          }
        } else if (pillLit < 0.5 || phaseRef.current !== "idle") {
          restingSince = 0;
          if (nagRef.current) {
            nagRef.current = false;
            setNag(false);
          }
        }
      },
    });
    flashlightRef.current = flashlight;

    // The deep loads after the page is up; without WebGL the page is whole.
    let gone = false;
    const deepCanvas = deepCanvasRef.current;
    if (deepCanvas) {
      void import("#/lib/deep-rain")
        .then(({ mountDeep }) => {
          if (gone) return;
          deepRef.current = mountDeep({
            canvas: deepCanvas,
            palette: vibeById(getPrefs().vibe).rain,
            onReady: () => setDeepReady(true),
          });
          deepRef.current.dive(phaseRef.current !== "idle");
        })
        .catch(() => {
          // No WebGL, or the chunk did not load: the deep stays dark.
        });
    }

    const fit = () => {
      fitSlots(stage);
      measure();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(stage);
    // The display face changes the size of the wordmark when it arrives.
    void document.fonts.ready.then(fit);

    // The wheel changes the size of the beam. A pinch (ctrl + wheel) stays
    // the browser's zoom.
    let scale = 1;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || phaseRef.current !== "idle") return;
      scale = clamp(scale * Math.exp(-event.deltaY * 0.0012), MIN_SCALE, MAX_SCALE);
      flashlight.setScale(scale);
    };
    stage.addEventListener("wheel", onWheel, { passive: true });

    return () => {
      stage.removeEventListener("wheel", onWheel);
      observer.disconnect();
      flashlight.destroy();
      flashlightRef.current = null;
      gone = true;
      deepRef.current?.dispose();
      deepRef.current = null;
    };
  }, []);

  // A render can add or remove what the light finds (the continue chip, the
  // counter, a name under an object): measure again.
  useLayoutEffect(() => {
    measureRef.current();
  }, [entered, canContinue, foundCount, unlockedNow, hint, night, status, peek, note, vibe]);

  useEffect(() => {
    flashlightRef.current?.setFlood(entered);
    // ENTER: the reader falls into the code, at full pace.
    deepRef.current?.dive(entered);
    if (entered) flashlightRef.current?.setPace(1);
  }, [entered]);

  // The ink remembers a reader who read it all.
  useEffect(() => {
    floorRef.current = allRead ? INK_REMEMBERS : 0;
  }, [allRead]);

  // The night hint is the first one only.
  useEffect(() => {
    if (!night) return;
    const timer = window.setTimeout(() => setNight(false), NIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [night]);

  // Any input at all: somebody is here. The SOS waits for nobody, and stops
  // the moment somebody comes.
  useEffect(() => {
    lastInputRef.current = performance.now();
    const onInput = () => {
      lastInputRef.current = performance.now();
      if (sosRef.current) {
        sosRef.current = false;
        flashlightRef.current?.signal([]);
      }
    };
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const name of events) window.addEventListener(name, onInput, { passive: true });
    return () => {
      for (const name of events) window.removeEventListener(name, onInput);
      window.clearTimeout(statusTimer.current);
    };
  }, []);

  /** A click that hit nothing. Six of them fast, and the battery gives out. */
  function clickInTheDark() {
    if (batteryRef.current) return;
    const { times, burst } = clickBurst(clicksRef.current, performance.now());
    clicksRef.current = times;
    const flashlight = flashlightRef.current;
    if (!burst || !flashlight) return;

    batteryRef.current = true;
    sosRef.current = false;
    window.clearTimeout(statusTimer.current);
    const spare = getPrefs().found.includes("battery");
    const says: Record<string, string> = {
      dead: copy.eggs.batteryDead,
      back: copy.eggs.batteryBack,
      swapped: copy.eggs.batterySwapped,
    };
    flashlight.signal(outage({ spare, calm: prefersReducedMotion() }), {
      onCue: (cue) => setStatus(says[cue] ?? null),
      onEnd: () => {
        batteryRef.current = false;
        statusTimer.current = window.setTimeout(() => setStatus(null), STATUS_MS);
      },
    });
  }

  // The engine takes the new palette live.
  useEffect(() => {
    flashlightRef.current?.setPalette(vibe.rain);
    deepRef.current?.setPalette(vibe.rain);
  }, [vibe]);

  // The code inside the letters, in the inks of the vibe.
  useEffect(() => {
    let gone = false;
    let made: CodeTiles[] = [];
    const { trail, alt, head } = vibe.rain;
    void Promise.all([
      codeTiles({ fill: trail.fill, head: head.fill }),
      codeTiles({ fill: alt.fill, head: head.fill }),
    ])
      .then((next) => {
        made = next;
        if (gone) next.forEach(revokeTiles);
        else setTiles(next);
      })
      .catch(() => {
        // No tiles: the letters stay outlined.
      });
    return () => {
      gone = true;
      made.forEach(revokeTiles);
    };
  }, [vibe]);

  // The hint names the input the reader has in hand.
  useEffect(() => {
    const show = (next: HintKind) => {
      if (hintRef.current === next) return;
      hintRef.current = next;
      setHintState(next);
    };
    const onPointer = (event: PointerEvent) =>
      show(event.pointerType === "mouse" ? "pointer" : "touch");
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Tab" || event.key.startsWith("Arrow")) show("keys");
    };
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  /** Leaves the page, once: for the library, or for a place in a document. */
  function go(place?: { slug: string; hash?: string }) {
    if (goneRef.current) return;
    goneRef.current = true;
    if (!place) {
      void navigate({ to: "/content" });
      return;
    }
    void navigate({ to: "/content/$slug", params: { slug: place.slug }, hash: place.hash });
  }

  /** Where the reader stopped: the last block of the document they were in last. */
  function continueReading() {
    const { doc, last } = getPrefs();
    const slug = entrySlug(doc);
    // A block id is a hash of the block, never its text.
    go(slug ? { slug, hash: last ?? undefined } : undefined);
  }

  /** `byKey`: the reader did not point at the pill, so the light goes there first. */
  function enter(byKey = false) {
    if (phaseRef.current !== "idle") {
      // A second click skips the rest of the show.
      go();
      return;
    }
    if (byKey && pillRef.current) {
      const { x, y } = centreOf(pillRef.current);
      flashlightRef.current?.aim(x, y);
    }
    // Entering wins over every egg: the flood cuts the signal that plays.
    batteryRef.current = false;
    sosRef.current = false;
    window.clearTimeout(statusTimer.current);
    setStatus(null);

    // Entered once: this visit and every later one take the fast lane.
    const seen = getPrefs().seen;
    showRef.current = seen ? FAST_LANE : FULL_SHOW;
    setFast(seen);
    setPrefs({ seen: true });

    // The fill completes when this settles. A failure is not final:
    // `navigate` loads the route again.
    loadedRef.current = false;
    const loaded = () => {
      loadedRef.current = true;
    };
    router.preloadRoute({ to: "/content" }).then(loaded, loaded);

    setPhase("flooding");
  }

  // The honest loader: the fill eases to 85 % on a timer and completes when
  // the document has loaded and the show has had its time.
  useEffect(() => {
    if (!entered) return;
    const fill = fillRef.current;
    const { flood, load, finish, hold } = showRef.current;
    const total = flood + load;
    const start = performance.now();
    let finishedAt = 0;
    let written = -1;

    const step = (now: number) => {
      const elapsed = now - start;
      let progress = HONEST_LIMIT * easeOut(Math.min(1, elapsed / total));

      if (finishedAt === 0) {
        if (elapsed >= flood && phaseRef.current === "flooding") setPhase("loading");
        if (elapsed >= total && loadedRef.current) {
          finishedAt = now;
          setPhase("done");
        }
      }
      if (finishedAt !== 0) {
        const sinceDone = now - finishedAt;
        progress = HONEST_LIMIT + (1 - HONEST_LIMIT) * Math.min(1, sinceDone / finish);
        if (sinceDone >= finish + hold) {
          go();
          return;
        }
      }

      // With reduced motion the fill moves in four steps.
      const value = prefersReducedMotion()
        ? Math.floor(progress * 4 + 0.001) / 4
        : Math.round(progress * 1000) / 1000;
      if (fill && value !== written) {
        written = value;
        fill.style.setProperty("--p", String(value));
      }
      frame = requestAnimationFrame(step);
    };
    let frame = requestAnimationFrame(step);

    return () => cancelAnimationFrame(frame);
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs once, when the reader enters
  }, [entered]);

  function collect(id: ObjectId, element: HTMLElement) {
    if (phaseRef.current !== "idle") return;
    const found = getPrefs().found;
    if (found.includes(id)) return;

    const next = [...found, id];
    setPrefs({ found: next });
    const count = OBJECTS.filter((object) => next.includes(object.id)).length;
    const all = count >= FOUND_TOTAL;
    if (all) setUnlockedNow(true);
    setNote({ id, text: all ? copy.enter.foundAll : copy.enter.found(count) });
    ping(element);
    // The moth leaves its pin for the light.
    if (id === "moth") setMothFrom(centreOf(element));
  }

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  /** Enter with no control in focus: takes the object the beam is on, if any. */
  function collectLit(): boolean {
    const found = getPrefs().found;
    let best: Target | null = null;
    for (const target of targetsRef.current) {
      const id = target.element.dataset.object;
      if (!id || found.includes(id) || target.shown < COLLECT_LIT) continue;
      if (!best || target.shown > best.shown) best = target;
    }
    if (!best) return false;
    collect(best.element.dataset.object as ObjectId, best.element);
    return true;
  }

  function onObjectClick(id: ObjectId, event: MouseEvent<HTMLButtonElement>) {
    const element = event.currentTarget;
    const lit = targetsRef.current.find((target) => target.element === element)?.shown ?? 0;
    // Only what the light is on can be taken. Keyboard focus brings the light.
    if (lit >= COLLECT_LIT || element.matches(":focus-visible")) collect(id, element);
  }

  function choose(next: Vibe, origin?: { x: number; y: number }) {
    if (phaseRef.current !== "idle") return;
    if (!isUnlocked(next.id, getPrefs())) {
      // Locked: its label says how it opens, for a moment.
      setPeek(next.id);
      window.clearTimeout(peekTimer.current);
      peekTimer.current = window.setTimeout(() => {
        // Still under the pointer or in focus: the label stays.
        const dot = dotsRef.current?.querySelector(`[data-vibe-dot="${next.id}"]`);
        if (!dot?.matches(":hover, :focus")) setPeek(null);
      }, NOTE_MS);
      return;
    }
    const dot = dotsRef.current?.querySelector(`[data-vibe-dot="${next.id}"]`);
    setVibe(next.id, origin ?? (dot ? centreOf(dot) : undefined));
  }

  function onDotClick(next: Vibe, event: MouseEvent<HTMLButtonElement>) {
    // A click from the keyboard has no point: the light spreads from the dot.
    choose(next, event.detail === 0 ? undefined : { x: event.clientX, y: event.clientY });
  }

  /** Arrows inside the radio group move between the lights, not the beam. */
  function onDotsKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    const dots = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-vibe-dot]"),
    );
    const at = dots.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    // The hotkeys must not also nudge the beam.
    event.preventDefault();
    const index = (at + step + dots.length) % dots.length;
    dots[index].focus();
    choose(VIBES[index]);
  }

  /** Focus from the keyboard brings the light: what has focus is never in the dark. */
  function onFocus(event: FocusEvent<HTMLElement>) {
    const element = event.target;
    if (phaseRef.current !== "idle" || !element.matches(":focus-visible")) return;
    const { x, y } = centreOf(element);
    flashlightRef.current?.aim(x, y);
  }

  const nudge = (dx: number, dy: number) => () => {
    if (phaseRef.current === "idle") flashlightRef.current?.nudge(dx, dy);
  };
  const aimKey = (keys: string, dx: number, dy: number): Hotkey => ({
    keys,
    label: copy.labels.aim,
    group: "light",
    hidden: true,
    run: nudge(dx, dy),
  });

  useHotkeys([
    aimKey("arrowleft", -NUDGE, 0),
    aimKey("arrowright", NUDGE, 0),
    aimKey("arrowup", 0, -NUDGE),
    aimKey("arrowdown", 0, NUDGE),
    aimKey("shift+arrowleft", -NUDGE_FAR, 0),
    aimKey("shift+arrowright", NUDGE_FAR, 0),
    aimKey("shift+arrowup", 0, -NUDGE_FAR),
    aimKey("shift+arrowdown", 0, NUDGE_FAR),
    {
      keys: "enter",
      label: copy.enter.label.toLowerCase(),
      group: "page",
      run: () => {
        if (phaseRef.current !== "idle" || !collectLit()) enter(true);
      },
    },
    {
      keys: "escape",
      label: copy.enter.skip,
      group: "page",
      hidden: true,
      run: () => {
        if (phaseRef.current !== "idle") go();
      },
    },
    ...VIBES.map((item, index): Hotkey => ({
      keys: String(index + 1),
      label: item.label,
      group: "light",
      run: () => choose(item),
    })),
  ]);

  const shownVibe = peek ? vibeById(peek) : vibe;
  const shownLocked = shownVibe.id === "cryo" && !cryoOpen;
  const caption =
    phase === "flooding"
      ? copy.enter.loading[0]
      : phase === "loading"
        ? copy.enter.loading[1]
        : phase === "done"
          ? copy.enter.loading[2]
          : "";
  const count =
    foundCount >= FOUND_TOTAL
      ? unlockedNow
        ? copy.enter.foundAll
        : ""
      : foundCount > 0
        ? copy.enter.found(foundCount)
        : "";
  // The keys hint is how a keyboard reader gets in: no egg covers it.
  const hintText =
    hint === "keys"
      ? HINTS.keys
      : night
        ? copy.eggs.night
        : allRead
          ? copy.eggs.allRead
          : HINTS[hint];
  const hintLine = hintParts(hintText);

  return (
    <main
      ref={stageRef}
      className="stage"
      data-phase={phase}
      data-entered={entered}
      onFocus={onFocus}
      onClick={(event) => {
        // With the lights on, a click anywhere skips the rest of the show.
        if (phaseRef.current !== "idle") go();
        // A click that no control took landed in the dark.
        else if (!(event.target as Element).closest("button, a")) clickInTheDark();
      }}
    >
      <h1 className="stage__title">{wordmark.join(" ")}</h1>

      {/* Furthest back: the deep rain, the shaft of the beam, the dive. */}
      <canvas
        ref={deepCanvasRef}
        className="stage__deep"
        data-ready={deepReady || undefined}
        aria-hidden="true"
      />

      {/* Under the rain: giant outlined letters. Each lights as the beam passes.
          The text comes from src/content/site.json. */}
      <div ref={wordmarkRef} className="wordmark" aria-hidden="true">
        {wordmark.map((word, row) => (
          <span
            key={row}
            className="wordmark__row"
            data-row={row}
            style={codeStyle(tiles[row === 1 ? 1 : 0])}
            // A short word is set wide, a long one narrow.
            data-wide={Array.from(word).length <= WIDE_LETTERS || undefined}
          >
            {Array.from(word.toUpperCase(), (letter, index) =>
              letter === " " ? (
                <span key={index} className="wordmark__space" />
              ) : (
                <span
                  key={index}
                  className="wordmark__letter"
                  data-lit="centre"
                  data-char={letter}
                  style={{ "--i": index + row * 7 } as CSSProperties}
                >
                  {/* Faces, back to front: the depth, the ink, the code inside. */}
                  <span className="wordmark__body">
                    {DEPTHS.map((depth) => (
                      <span
                        key={depth}
                        className="wordmark__depth"
                        style={{ "--d": depth } as CSSProperties}
                      >
                        {letter}
                      </span>
                    ))}
                    <span className="wordmark__ink">{letter}</span>
                    <span className="wordmark__code">{letter}</span>
                  </span>
                </span>
              ),
            )}
          </span>
        ))}
        {/* One row still leaves the gap for the button below it. */}
        {wordmark.length === 1 && <span className="wordmark__row" data-row={1} />}
      </div>

      <canvas ref={canvasRef} className="stage__rain" aria-hidden="true" />

      {/* Over the rain and the letters, behind the plates. */}
      {hasMoth && <Moth ref={mothRef} from={mothFrom ?? undefined} />}

      <div className="gate">
        <button
          ref={pillRef}
          type="button"
          className="enter"
          data-lit=""
          data-phase={phase}
          aria-label={copy.enter.label.toLowerCase()}
          aria-busy={entered && phase !== "done"}
          // The pointer on ENTER: time in the rain slows, as before a jump.
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse" && phaseRef.current === "idle")
              flashlightRef.current?.setPace(HOVER_PACE);
          }}
          onPointerLeave={() => flashlightRef.current?.setPace(1)}
          onClick={(event) => {
            event.stopPropagation();
            // `detail` is 0 for a click that came from the keyboard.
            enter(event.detail === 0);
          }}
        >
          <span className="enter__body">
            <Slots text={label} />
            {/* The fill carries the same label in the ink for a lit surface. */}
            <span ref={fillRef} className="enter__fill" aria-hidden="true">
              <Slots text={label} />
            </span>
          </span>
        </button>

        <div className="gate__below">
          {canContinue && (
            <button
              type="button"
              className="continue"
              data-lit=""
              onClick={(event) => {
                event.stopPropagation();
                continueReading();
              }}
            >
              {copy.enter.continue(prefs.percent)}
            </button>
          )}
          <p className="gate__caption" aria-live="polite">
            {caption && (
              // A new caption is a new element: it gets lit again.
              <span key={caption} className="gate__status">
                {caption}
              </span>
            )}
            {entered && phase !== "done" && !fast && (
              <span className="gate__skip">{copy.enter.skip}</span>
            )}
          </p>
        </div>
      </div>

      {OBJECTS.map((object) => {
        const isFound = prefs.found.includes(object.id);
        const says = note?.id === object.id ? note.text : null;
        return (
          <button
            key={object.id}
            type="button"
            className="found"
            data-lit=""
            data-object={object.id}
            aria-label={copy.enter.objects[object.id]}
            aria-pressed={isFound}
            tabIndex={entered ? -1 : 0}
            onClick={(event) => {
              event.stopPropagation();
              if (phaseRef.current !== "idle") go();
              else onObjectClick(object.id, event);
            }}
          >
            <span className="found__art" aria-hidden="true">
              {(isFound ? object.found : object.dark).join("\n")}
            </span>
            {isFound && (
              <span className="found__tag" data-says={says ? "" : undefined} aria-hidden="true">
                {says ?? copy.enter.objects[object.id]}
              </span>
            )}
          </button>
        );
      })}

      <div className="stage__foot">
        <p className="hint" data-lit="" data-status={status ? "" : undefined}>
          {/* What the flashlight says takes the place of the hint. The live
              region is always there, so a reader who cannot see it hears it. */}
          <span className="hint__live" aria-live="polite">
            {status && (
              <span key={status} className="hint__text">
                {status}
              </span>
            )}
          </span>
          {!status && (
            // A new hint is a new element: it gets lit again.
            <span key={hintText} className="hint__text">
              {hintLine.parts.map((part, index) => (
                <span key={part}>
                  {index > 0 && hintLine.joint}
                  <span className="hint__part">{part}</span>
                </span>
              ))}
            </span>
          )}
        </p>

        <div className="vibes">
          {count && (
            <p className="vibes__count" data-lit="">
              {count}
            </p>
          )}
          <div className="vibes__row">
            <p className="vibes__label" data-lit="" aria-hidden="true">
              <span className="vibes__name">{shownVibe.label}</span>
              <span className="vibes__note">
                {shownLocked ? copy.comfort.locked : shownVibe.note}
              </span>
            </p>
            <div
              ref={dotsRef}
              className="vibes__dots"
              role="radiogroup"
              aria-label={copy.comfort.light}
              onKeyDown={onDotsKeyDown}
            >
              {VIBES.map((item) => {
                const checked = item.id === vibe.id;
                const locked = item.id === "cryo" && !cryoOpen;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    className="vibe-dot"
                    data-lit=""
                    data-vibe-dot={item.id}
                    aria-checked={checked}
                    aria-disabled={locked || undefined}
                    aria-label={`${item.label}. ${locked ? copy.comfort.locked : item.note}`}
                    tabIndex={entered ? -1 : checked ? 0 : -1}
                    style={{ "--swatch": item.swatch } as CSSProperties}
                    onClick={(event) => {
                      if (phaseRef.current === "idle") event.stopPropagation();
                      onDotClick(item, event);
                    }}
                    onPointerEnter={() => setPeek(item.id)}
                    onPointerLeave={() => setPeek(null)}
                    onFocus={() => setPeek(item.id)}
                    onBlur={() => setPeek(null)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* What was just found, for a reader who cannot see it. */}
      <p className="stage__title" role="status">
        {note?.text}
      </p>
    </main>
  );
}
