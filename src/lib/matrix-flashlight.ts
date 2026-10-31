/**
 * Matrix rain that exists only inside a flashlight beam.
 *
 * The rain is simulated for the whole viewport, but a glyph is drawn only when
 * the beam reaches its cell. Everything outside the beam is never painted, so
 * the page stays pure black and a frame costs O(cells in the beam).
 */

import { clamp } from "#/lib/math";
import { prefersReducedMotion } from "#/lib/reduced-motion";
import { VIBES } from "#/lib/vibes";
import type { RainPalette } from "#/lib/vibes";

/** Katakana of the rain. The film shows them mirrored. */
export const KANA = "ｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜﾝ";
export const GLYPHS = `${KANA}0123456789Z:.=*+-<>|`.split("");
const GLYPH_COUNT = GLYPHS.length;

export const FONT_STACK = '"SF Mono", Menlo, Monaco, Consolas, "MS Gothic", monospace';

/** Cell and glow sizes in CSS pixels. */
const CELL_WIDTH = 18;
const CELL_HEIGHT = 22;
const FONT_SIZE = 16;
const GLOW_PADDING = 8;

const STREAMS_PER_COLUMN = 3;
const MIN_SPEED = 7; // rows per second
const MAX_SPEED = 24;
const MIN_LENGTH = 8; // rows
const MAX_LENGTH = 30;

/** Share of the beam radius that is fully lit; the rest is the soft edge. */
const BEAM_CORE = 0.3;
/** Brightness of a glyph that no stream currently crosses. */
const DORMANT_GLYPH = 0.07;
const MIN_VISIBLE_ALPHA = 0.012;

/** The beam can be this much smaller or larger than its natural size. */
export const MIN_SCALE = 0.6;
export const MAX_SCALE = 1.6;

/** Haze alpha at the centre of the beam and at 45 % of its radius. */
const HAZE_ALPHA = 0.14;
const HAZE_EDGE_ALPHA = 0.04;

/** Every stream whose index divides by this takes the second ink. */
const ALT_EVERY = 5;
/** Below this falloff a cell is in the soft edge of the beam: the fringe ink. */
const FRINGE_EDGE = 0.45;
/** The fringe is dim by definition (it is the edge). This lifts it into view. */
const FRINGE_GAIN = 1.5;

/** Seconds without a pointer before the beam starts to sweep by itself. */
const SWEEP_DELAY = 2.5;
/** Radians per second of the slow figure of eight. One lap: about 19 s. */
const SWEEP_RATE = 0.33;
/** Reach of the sweep from the centre, as a share of the width and the height. */
const SWEEP_REACH_X = 0.36;
const SWEEP_REACH_Y = 0.3;
/** The sweeping beam drifts after its target; a steered beam follows at once. */
const SWEEP_FOLLOW = 2.4;
const STEER_FOLLOW = 18;
/** A beam nobody holds is a little dimmer than one that is steered. */
const SWEEP_POWER = 0.9;
/** Seconds the light stays on after a finger lifts. */
const TOUCH_LINGER = 1.2;

/** How fast the pace of the rain reaches a new one, per second. */
const PACE_RATE = 5;

/** While draining, the rain speeds up by this much per second squared. */
const DRAIN_GRAVITY = 8;
/** Seconds for the haze and the dormant glyphs to fade once draining starts. */
const DRAIN_FADE = 0.8;

/** How fast a power step reaches its level when it names no rate, per second. */
const STEP_RATE = 40;
/** How fast the power returns to normal after a signal, per second. */
const RETURN_RATE = 8;
/** An over-bright beam (level above 1) is also this much wider per unit of excess. */
const FLARE_GROWTH = 0.25;

/** Half-life of the afterglow of phosphorescent ink, in seconds. */
export const AFTERGLOW_HALF_LIFE = 1.2;
/** An afterglow this close to the light it decays to is that light. */
const AFTERGLOW_END = 0.004;

/**
 * Phosphorescent ink: light that arrives is shown at once; light that leaves
 * fades with a half-life. `shown` is the value of the last frame, `light` the
 * light that reaches the ink now, `dt` the seconds since the last frame.
 */
export function afterglow(
  shown: number,
  light: number,
  dt: number,
  halfLife = AFTERGLOW_HALF_LIFE,
): number {
  if (light >= shown || halfLife <= 0) return light;
  const glow = light + (shown - light) * 2 ** (-dt / halfLife);
  // A glow only approaches the light; it must also arrive.
  return glow - light < AFTERGLOW_END ? light : glow;
}

/** One stretch of a power signal. */
export interface PowerStep {
  /** Factor on the beam's power: 0 = out, 1 = as it is, above 1 = over-bright. */
  level: number;
  /** How long the step lasts. */
  seconds: number;
  /** How fast the level is reached, per second (default 40: a cut with a soft edge). */
  rate?: number;
  /** Passed to `onCue` when the step begins. */
  cue?: string;
}

export interface SignalHandlers {
  onCue?: (cue: string) => void;
  /** The last step is over. Not called when the signal is replaced or cut. */
  onEnd?: () => void;
}

/** The index of the step that plays `t` seconds into `steps`; -1 once they are over. */
export function stepAt(steps: readonly PowerStep[], t: number): number {
  let end = 0;
  for (let index = 0; index < steps.length; index++) {
    end += steps[index].seconds;
    if (t < end) return index;
  }
  return -1;
}

/**
 * A message in Morse for the beam. `code` is dots and dashes, a space between
 * letters: `"... --- ..."`. On is full power; off is `low`, never 0, so the
 * page never flashes dark. Standard timing in `unit` seconds: a dot 1, a dash
 * 3, the gap inside a letter 1, between letters 3. The message starts after a
 * pause of 3 and ends with one of 7, so its first and last marks read as marks.
 */
export function morse(code: string, unit: number, low: number): PowerStep[] {
  const off = (units: number): PowerStep => ({ level: low, seconds: unit * units });
  const steps: PowerStep[] = [off(3)];
  code
    .trim()
    .split(/\s+/)
    .forEach((letter, letterIndex) => {
      if (letterIndex > 0) steps.push(off(3));
      Array.from(letter).forEach((mark, markIndex) => {
        if (markIndex > 0) steps.push(off(1));
        steps.push({ level: 1, seconds: unit * (mark === "-" ? 3 : 1) });
      });
    });
  steps.push(off(7));
  return steps;
}

/**
 * The battery gives out. The beam sputters (three dips, at most three a
 * second), goes out for 2 s, and comes back. With a spare battery it is
 * swapped after the sputter: the beam returns at once with a short
 * over-bright pulse. With less motion: no sputter and no pulse, a plain fade
 * out and back.
 *
 * Cues: `"dead"` as the light goes out, `"back"` as it returns, or
 * `"swapped"` as it goes out when there is a spare.
 */
export function outage({ spare, calm }: { spare: boolean; calm: boolean }): PowerStep[] {
  if (calm) {
    return [
      { level: 0, seconds: spare ? 0.8 : 2.4, rate: 6, cue: spare ? "swapped" : "dead" },
      { level: 1, seconds: 0.6, rate: 5, cue: spare ? undefined : "back" },
    ];
  }
  // Uneven on purpose: a contact that fails is not a metronome.
  const sputter: PowerStep[] = [
    { level: 0.3, seconds: 0.09, rate: 60 },
    { level: 0.95, seconds: 0.27, rate: 30 },
    { level: 0.06, seconds: 0.08, rate: 60 },
    { level: 0.6, seconds: 0.26, rate: 25 },
  ];
  return spare
    ? [
        ...sputter,
        { level: 0, seconds: 0.45, rate: 20, cue: "swapped" },
        { level: 1.4, seconds: 0.12, rate: 30 },
        { level: 1, seconds: 0.4, rate: 8 },
      ]
    : [
        ...sputter,
        { level: 0, seconds: 2, rate: 14, cue: "dead" },
        { level: 1, seconds: 0.5, rate: 6, cue: "back" },
      ];
}

export interface Light {
  /** Beam centre in viewport CSS pixels, like `getBoundingClientRect`. */
  x: number;
  y: number;
  /** Beam radius in CSS pixels. */
  radius: number;
  /** 0 = off, 1 = fully on. */
  power: number;
  /** How fast the rain falls against its natural pace (see `setPace`), eased. */
  pace: number;
}

export interface FlashlightOptions {
  /** Runs after every frame with the beam that was just drawn. */
  onLight?: (light: Light) => void;
  /** Start with the whole viewport lit, as if `setFlood(true)` had settled. */
  flooded?: boolean;
  /** The inks of the rain and the haze. Default: the first vibe. */
  palette?: RainPalette;
  /**
   * Let the beam move by itself while nobody steers it: a slow figure of eight
   * that crosses the centre of the canvas. It starts shortly after the canvas
   * appears and again 2.5 s after the pointer leaves. With reduced motion the
   * beam does not move: it is parked on the centre at full power.
   */
  sweep?: boolean;
}

export interface Flashlight {
  /** Light the whole viewport (`true`) or return to the beam (`false`). */
  setFlood: (on: boolean) => void;
  /** Stop new streams, let the rain fall off the screen, then call `onDone`. */
  drain: (onDone: () => void) => void;
  destroy: () => void;
  /** Changes the inks. The glyph atlas is drawn again. */
  setPalette: (palette: RainPalette) => void;
  /** Points the beam at a place, in viewport CSS pixels, and switches it on. */
  aim: (x: number, y: number) => void;
  /** Moves the beam by a distance in CSS pixels (keyboard steering). */
  nudge: (dx: number, dy: number) => void;
  /** Beam size against its natural size, clamped to 0.6..1.6. */
  setScale: (scale: number) => void;
  /**
   * Plays a power signal: the beam's power is scaled by each step's level in
   * turn, then returns to normal. A new signal replaces the one playing; `[]`
   * cuts it. The flood cuts it too.
   */
  signal: (steps: readonly PowerStep[], handlers?: SignalHandlers) => void;
  /** Nobody holds the light and the engine moves it: the idle sweep is on. */
  isSweeping: () => boolean;
  /**
   * Sets how fast the rain falls against its natural pace (1). The rain eases
   * to it in about half a second: time slows, it does not stop.
   */
  setPace: (pace: number) => void;
}

function smoothstep(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

/** Brightness of a point at `distance` from the centre of a beam. */
export function beamFalloff(distance: number, radius: number): number {
  return 1 - smoothstep((distance - radius * BEAM_CORE) / (radius * (1 - BEAM_CORE)));
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomIndex(count: number): number {
  return Math.floor(Math.random() * count);
}

function randomGlyphIndex(): number {
  return randomIndex(GLYPH_COUNT);
}

/** Moves `value` toward `target` at a frame-rate independent `rate`. */
function approach(value: number, target: number, rate: number, dt: number): number {
  return value + (target - value) * (1 - Math.exp(-rate * dt));
}

/** Atlas rows. A cell picks its ink by picking a row. */
const ROW_TRAIL = 0;
const ROW_HEAD = 1;
const ROW_ALT = 2;
const ROW_FRINGE = 3;

/**
 * Pre-renders every glyph with its glow, one row per ink: the trail, the
 * bright stream head, the second ink of the duotone rain, and the ink of the
 * soft edge of the beam. Drawing a tile is then a plain `drawImage`, whatever
 * its ink.
 */
function buildAtlas(
  dpr: number,
  tileWidth: number,
  tileHeight: number,
  palette: RainPalette,
): HTMLCanvasElement {
  // In the order of the `ROW_*` constants.
  const rows = [
    { ...palette.trail, blur: 5 },
    { ...palette.head, blur: 9 },
    { ...palette.alt, blur: 5 },
    { ...palette.fringe, blur: 7 },
  ];

  const atlas = document.createElement("canvas");
  atlas.width = tileWidth * GLYPH_COUNT;
  atlas.height = tileHeight * rows.length;

  const ctx = atlas.getContext("2d");
  if (!ctx) return atlas;

  ctx.font = `${Math.round(FONT_SIZE * dpr)}px ${FONT_STACK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  rows.forEach((row, rowIndex) => {
    ctx.fillStyle = row.fill;
    ctx.shadowColor = row.glow;
    ctx.shadowBlur = row.blur * dpr;

    GLYPHS.forEach((glyph, index) => {
      ctx.save();
      ctx.translate((index + 0.5) * tileWidth, (rowIndex + 0.5) * tileHeight);
      // The film shows its katakana mirrored.
      if (index < KANA.length) ctx.scale(-1, 1);
      ctx.fillText(glyph, 0, 0);
      ctx.restore();
    });
  });

  return atlas;
}

export function createFlashlight(
  canvas: HTMLCanvasElement,
  options: FlashlightOptions = {},
): Flashlight {
  const context = canvas.getContext("2d");
  if (!context) {
    return {
      setFlood() {},
      drain: (onDone) => onDone(),
      destroy() {},
      setPalette() {},
      aim() {},
      nudge() {},
      setScale() {},
      signal() {},
      isSweeping: () => false,
      setPace: () => {},
    };
  }
  const ctx = context;

  let palette = options.palette ?? VIBES[0].rain;
  const sweep = options.sweep ?? false;

  // Everything below is in device pixels unless a name says otherwise.
  let dpr = 0; // 0 until the first `resize`
  /** Canvas position in the viewport, CSS pixels. */
  let originX = 0;
  let originY = 0;
  let width = 0;
  let height = 0;
  let cellWidth = 0;
  let cellHeight = 0;
  let padding = 0;
  let tileWidth = 0;
  let tileHeight = 0;
  let cols = 0;
  let rows = 0;
  let atlas: HTMLCanvasElement | null = null;

  let glyphs = new Uint8Array(0);
  let heads = new Float32Array(0);
  let speeds = new Float32Array(0);
  let lengths = new Float32Array(0);

  let x = 0;
  let y = 0;
  let targetX = 0;
  let targetY = 0;
  /** Somebody steered the beam at least once: a pointer, a key or `aim`. */
  let steered = false;
  /** A pointer on the page, a key or `aim` holds the light on. */
  let held = false;
  /** Seconds the light still stays on after a finger lifted. */
  let linger = 0;
  /** Seconds since anybody held the light. */
  let idle = 0;
  /** Nobody holds the light, so the engine does: it sweeps, or it is parked. */
  let auto = false;
  /** Seconds of sweep so far. It stops while somebody steers, so the path resumes. */
  let sweepTime = 0;
  /** Beam size against its natural size; `scale` eases toward `targetScale`. */
  let scale = 1;
  let targetScale = 1;
  let floodOn = options.flooded ?? false;
  let flood = floodOn ? 1 : 0;
  let power = flood;
  /** Seconds since `drain` was called; negative while the rain still falls. */
  let drainTime = -1;
  let onDrained: (() => void) | null = null;
  /** The sweep moved the beam on the last frame. */
  let sweepingNow = false;

  /** The power signal that plays, and where it is. */
  let signalSteps: readonly PowerStep[] = [];
  let signalHandlers: SignalHandlers = {};
  let signalTime = 0;
  let signalIndex = -1;
  /** Factor on the power from the signal; it eases toward `levelTarget`. */
  let level = 1;
  let levelTarget = 1;
  let levelRate = RETURN_RATE;

  let frame = 0;
  let lastTime = 0;
  let dirty: { x: number; y: number; w: number; h: number } | null = null;

  function resetStream(index: number, scatter: boolean) {
    if (drainTime >= 0) {
      // A drained stream never comes back.
      heads[index] = Infinity;
      return;
    }
    lengths[index] = randomBetween(MIN_LENGTH, MAX_LENGTH);
    speeds[index] = randomBetween(MIN_SPEED, MAX_SPEED);
    // `scatter` spreads streams over the whole column so the rain is already
    // falling everywhere on the first frame.
    heads[index] = scatter ? randomBetween(-rows, rows) : -randomBetween(0, rows * 0.6);
  }

  function resize() {
    const nextDpr = Math.min(window.devicePixelRatio || 1, 2);
    const bounds = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(bounds.width * nextDpr));
    const nextHeight = Math.max(1, Math.round(bounds.height * nextDpr));
    originX = bounds.left;
    originY = bounds.top;
    if (nextDpr === dpr && nextWidth === width && nextHeight === height) return;

    if (nextDpr !== dpr) {
      dpr = nextDpr;
      cellWidth = Math.round(CELL_WIDTH * dpr);
      cellHeight = Math.round(CELL_HEIGHT * dpr);
      padding = Math.round(GLOW_PADDING * dpr);
      tileWidth = cellWidth + padding * 2;
      tileHeight = cellHeight + padding * 2;
      atlas = buildAtlas(dpr, tileWidth, tileHeight, palette);
    }

    width = nextWidth;
    height = nextHeight;
    canvas.width = width;
    canvas.height = height;
    dirty = null;

    cols = Math.ceil(width / cellWidth);
    rows = Math.ceil(height / cellHeight);

    glyphs = new Uint8Array(cols * rows);
    for (let i = 0; i < glyphs.length; i++) glyphs[i] = randomGlyphIndex();

    const streamCount = cols * STREAMS_PER_COLUMN;
    heads = new Float32Array(streamCount);
    speeds = new Float32Array(streamCount);
    lengths = new Float32Array(streamCount);
    for (let i = 0; i < streamCount; i++) resetStream(i, true);

    if (!steered) {
      x = targetX = width / 2;
      y = targetY = height / 2;
    }
  }

  function simulate(dt: number) {
    const draining = drainTime >= 0;
    if (draining) drainTime += dt;
    // Draining rain accelerates, as if gravity took over.
    const gravity = draining ? 1 + DRAIN_GRAVITY * drainTime * drainTime : 1;
    const pace = (prefersReducedMotion() ? 0.2 : 1) * gravity * paceNow;
    let falling = 0;

    for (let index = 0; index < heads.length; index++) {
      if (heads[index] === Infinity) continue;
      falling += 1;
      const col = Math.floor(index / STREAMS_PER_COLUMN);
      const before = Math.floor(heads[index]);
      const head = heads[index] + speeds[index] * pace * dt;
      heads[index] = head;

      // A head writes a fresh glyph into every cell it enters.
      const last = Math.min(Math.floor(head), rows - 1);
      for (let row = Math.max(before + 1, 0); row <= last; row++) {
        glyphs[row * cols + col] = randomGlyphIndex();
      }

      if (head - lengths[index] > rows) resetStream(index, false);
    }

    // Glyphs that already fell keep mutating.
    const mutations = Math.ceil(glyphs.length * 0.5 * pace * dt);
    for (let i = 0; i < mutations; i++) {
      glyphs[randomIndex(glyphs.length)] = randomGlyphIndex();
    }

    if (draining && falling === 0 && onDrained) {
      const done = onDrained;
      onDrained = null;
      done();
    }
  }

  /** `shown`: the power shown, the beam's times the signal's level. */
  function draw(radius: number, shown: number) {
    if (dirty) {
      ctx.clearRect(dirty.x, dirty.y, dirty.w, dirty.h);
      dirty = null;
    }
    if (!atlas || shown < 0.003) return;

    const left = Math.max(0, Math.floor(x - radius));
    const top = Math.max(0, Math.floor(y - radius));
    const right = Math.min(width, Math.ceil(x + radius));
    const bottom = Math.min(height, Math.ceil(y + radius));
    if (right <= left || bottom <= top) return;

    // Glow tiles overhang their cells, so the area to clear next frame is wider.
    const dirtyLeft = Math.max(0, left - cellWidth - padding);
    const dirtyTop = Math.max(0, top - cellHeight - padding);
    dirty = {
      x: dirtyLeft,
      y: dirtyTop,
      w: Math.min(width, right + cellWidth + padding) - dirtyLeft,
      h: Math.min(height, bottom + cellHeight + padding) - dirtyTop,
    };

    // The lit disc itself: a faint haze, so the beam reads as light on a surface.
    // Draining, everything except the falling streams fades out.
    const calm = drainTime < 0 ? 1 : Math.max(0, 1 - drainTime / DRAIN_FADE);
    const dormant = DORMANT_GLYPH * calm;
    const haze = shown * (1 - 0.75 * flood) * calm;
    const [hazeR, hazeG, hazeB] = palette.haze;
    const [edgeR, edgeG, edgeB] = palette.hazeEdge;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${hazeR}, ${hazeG}, ${hazeB}, ${HAZE_ALPHA * haze})`);
    gradient.addColorStop(0.45, `rgba(${edgeR}, ${edgeG}, ${edgeB}, ${HAZE_EDGE_ALPHA * haze})`);
    gradient.addColorStop(1, `rgba(${edgeR}, ${edgeG}, ${edgeB}, 0)`);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = gradient;
    ctx.fillRect(left, top, right - left, bottom - top);

    ctx.globalCompositeOperation = "lighter";

    const firstCol = Math.floor(left / cellWidth);
    const lastCol = Math.min(cols - 1, Math.floor(right / cellWidth));
    const firstRow = Math.floor(top / cellHeight);
    const lastRow = Math.min(rows - 1, Math.floor(bottom / cellHeight));

    // Squared distances keep the square root out of most of the loop: cells
    // outside the beam are skipped and cells in its core are fully lit.
    const radiusSquared = radius * radius;
    const coreSquared = radiusSquared * BEAM_CORE * BEAM_CORE;

    for (let col = firstCol; col <= lastCol; col++) {
      const cellX = col * cellWidth;
      const dx = cellX + cellWidth / 2 - x;
      const streamBase = col * STREAMS_PER_COLUMN;

      for (let row = firstRow; row <= lastRow; row++) {
        const cellY = row * cellHeight;
        const dy = cellY + cellHeight / 2 - y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared >= radiusSquared) continue;

        let trail = 0;
        let isHead = false;
        // The stream that lights this cell most gives the cell its ink.
        let lead = -1;
        for (let s = 0; s < STREAMS_PER_COLUMN; s++) {
          const behind = heads[streamBase + s] - row;
          const length = lengths[streamBase + s];
          if (behind < 0 || behind >= length) continue;
          const strength = 1 - behind / length;
          if (strength > trail) {
            trail = strength;
            lead = streamBase + s;
          }
          if (behind < 1) isHead = true;
        }

        // trail^1.5 without `Math.pow`.
        const brightness = isHead ? 1 : Math.max(dormant, trail * Math.sqrt(trail) * 0.9);
        const falloff =
          distanceSquared <= coreSquared ? 1 : beamFalloff(Math.sqrt(distanceSquared), radius);

        // One ink per cell, so still one `drawImage` per cell. The soft edge
        // of the beam is the fringe ink: the beam has a chromatic edge.
        // Inside it, every fifth stream is the second ink: duotone rain.
        let ink = ROW_TRAIL;
        // Over-bright (a signal above 1) lifts the dim cells; none goes past 1.
        let alpha = Math.min(1, brightness * falloff * shown);
        if (falloff < FRINGE_EDGE) {
          ink = ROW_FRINGE;
          alpha = Math.min(1, alpha * FRINGE_GAIN);
        } else if (isHead) {
          ink = ROW_HEAD;
        } else if (lead >= 0 && lead % ALT_EVERY === 0) {
          ink = ROW_ALT;
        }
        if (alpha < MIN_VISIBLE_ALPHA) continue;

        ctx.globalAlpha = alpha;
        ctx.drawImage(
          atlas,
          glyphs[row * cols + col] * tileWidth,
          ink * tileHeight,
          tileWidth,
          tileHeight,
          cellX - padding,
          cellY - padding,
          tileWidth,
          tileHeight,
        );
      }
    }
  }

  function setSignal(steps: readonly PowerStep[], handlers: SignalHandlers = {}) {
    signalSteps = steps;
    signalHandlers = handlers;
    signalTime = 0;
    signalIndex = -1;
    if (steps.length === 0) {
      levelTarget = 1;
      levelRate = RETURN_RATE;
    }
  }

  /** Moves the signal on and eases its level. */
  function runSignal(dt: number) {
    if (signalSteps.length > 0) {
      const steps = signalSteps;
      const handlers = signalHandlers;
      signalTime += dt;
      const index = stepAt(steps, signalTime);
      const reached = index < 0 ? steps.length - 1 : index;
      // Every step that began since the last frame gives its cue, even one
      // shorter than a frame.
      for (let step = signalIndex + 1; step <= reached; step++) {
        const cue = steps[step].cue;
        if (cue) handlers.onCue?.(cue);
        // A cue may have started another signal.
        if (signalSteps !== steps) return;
      }
      signalIndex = reached;
      if (index < 0) {
        setSignal([]);
        handlers.onEnd?.();
      } else {
        levelTarget = steps[index].level;
        levelRate = steps[index].rate ?? STEP_RATE;
      }
    }
    level = approach(level, levelTarget, levelRate, dt);
  }

  /** The pace of the rain: the one asked for, and the one shown. */
  let paceTarget = 1;
  let paceNow = 1;

  function tick(time: number) {
    frame = requestAnimationFrame(tick);
    const dt = Math.min(0.05, (time - lastTime) / 1000);
    lastTime = time;

    paceNow = approach(paceNow, paceTarget, PACE_RATE, dt);
    simulate(dt);
    runSignal(dt);

    const calm = prefersReducedMotion();

    if (held) {
      idle = 0;
    } else {
      idle += dt;
      linger = Math.max(0, linger - dt);
    }

    // Nobody holds the light: the engine takes it. With reduced motion the
    // beam is parked at once; otherwise it waits, then sweeps.
    const wait = calm && !steered ? 0 : SWEEP_DELAY;
    auto = sweep && !held && !floodOn && drainTime < 0 && idle >= wait;
    if (auto && calm) {
      // Parked on the centre, where the button is. A cut, not a move: the
      // light went out before it comes back here.
      x = targetX = width / 2;
      y = targetY = height / 2;
    } else if (auto) {
      // A slow figure of eight (a 1:2 Lissajous). It passes through the
      // centre twice a lap, and its long axis is the long side of the canvas.
      sweepTime += dt;
      const angle = sweepTime * SWEEP_RATE;
      const wide = width >= height;
      targetX = width / 2 + width * SWEEP_REACH_X * Math.sin(wide ? angle : angle * 2);
      targetY = height / 2 + height * SWEEP_REACH_Y * Math.sin(wide ? angle * 2 : angle);
    }
    const sweeping = auto && !calm;
    sweepingNow = sweeping;

    const on = floodOn || held || linger > 0 || auto;
    const follow = sweeping ? SWEEP_FOLLOW : STEER_FOLLOW;
    x = approach(x, targetX, follow, dt);
    y = approach(y, targetY, follow, dt);
    power = approach(power, on ? (sweeping ? SWEEP_POWER : 1) : 0, on ? 9 : 5, dt);
    flood = approach(flood, floodOn ? 1 : 0, 2.4, dt);

    scale = approach(scale, targetScale, 12, dt);

    const seconds = time / 1000;
    const flicker = calm ? 1 : 1 + 0.01 * Math.sin(seconds * 13) + 0.006 * Math.sin(seconds * 37.7);
    const beam = Math.max(170 * dpr, Math.min(width, height) * 0.3) * flicker * scale;

    // Flooded, the fully lit core of the beam must reach the farthest corner.
    const farthest = Math.hypot(Math.max(x, width - x), Math.max(y, height - y));
    // An over-bright beam is a little wider too.
    const flare = 1 + FLARE_GROWTH * Math.max(0, level - 1);
    const radius = (beam + ((farthest / BEAM_CORE) * 1.05 - beam) * smoothstep(flood)) * flare;
    const shown = power * level;

    draw(radius, shown);
    options.onLight?.({
      x: originX + x / dpr,
      y: originY + y / dpr,
      radius: radius / dpr,
      power: Math.min(1, shown),
      pace: paceNow,
    });
  }

  /** Points the beam at a place in viewport CSS pixels and switches it on. */
  function aimAt(clientX: number, clientY: number) {
    targetX = (clientX - originX) * dpr;
    targetY = (clientY - originY) * dpr;
    if (power < 0.05) {
      // The light is off: switch it on where it is wanted. A light that is
      // on (the sweep, the flood) glides there instead.
      x = targetX;
      y = targetY;
    }
    steered = true;
    held = true;
  }

  function aim(event: PointerEvent) {
    aimAt(event.clientX, event.clientY);
  }

  function release(event: PointerEvent) {
    if (event.pointerType === "mouse") return;
    // A lifted finger has no position. The light lingers where it was, then
    // goes out.
    held = false;
    linger = TOUCH_LINGER;
  }

  function leave() {
    held = false;
  }

  // One signal removes every listener in `destroy`.
  const listeners = new AbortController();
  const { signal } = listeners;
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  window.addEventListener("pointermove", aim, { signal });
  window.addEventListener("pointerdown", aim, { signal });
  window.addEventListener("pointerup", release, { signal });
  window.addEventListener("pointercancel", release, { signal });
  document.documentElement.addEventListener("pointerleave", leave, { signal });

  resize();
  frame = requestAnimationFrame(tick);

  return {
    setFlood(on) {
      floodOn = on;
      // Nothing dims the flood.
      if (on) setSignal([]);
    },
    drain(onDone) {
      onDrained = onDone;
      drainTime = 0;
    },
    destroy() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      listeners.abort();
    },
    setPalette(next) {
      if (next === palette) return;
      palette = next;
      // Before the first `resize` there is no atlas to replace yet.
      if (dpr > 0) atlas = buildAtlas(dpr, tileWidth, tileHeight, palette);
    },
    aim: aimAt,
    nudge(dx, dy) {
      // A nudge starts from where the light is now: the centre at first, or
      // wherever the sweep carried it.
      if (!held) {
        targetX = x;
        targetY = y;
      }
      steered = true;
      held = true;
      targetX = Math.min(width, Math.max(0, targetX + dx * dpr));
      targetY = Math.min(height, Math.max(0, targetY + dy * dpr));
    },
    setScale(next) {
      if (Number.isFinite(next)) targetScale = clamp(next, MIN_SCALE, MAX_SCALE);
    },
    signal(steps, handlers) {
      // The flood is all light: no signal plays over it.
      setSignal(floodOn ? [] : steps, handlers);
    },
    isSweeping: () => sweepingNow,
    setPace(pace) {
      paceTarget = Math.max(0, pace);
    },
  };
}
