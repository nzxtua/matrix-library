/**
 * A wave of scrambled characters that runs across ASCII art.
 *
 * The wave starts at one cell and grows as a ring. Inside the ring the
 * characters of the art are settled; on the ring they scramble; outside it
 * they are either hidden (`reveal`: the art decodes out of nothing) or
 * settled (`ripple`: the art shivers once). Only cells that carry ink take
 * part, so the outline of the art never changes.
 *
 * Nothing here knows the image: the size of the wave, its speed and its
 * width come from the art. Another logo gets the same feel.
 */

import { CELL_ASPECT, SOLID_GLYPHS } from "#/lib/ascii-art";

export type StormKind = "reveal" | "ripple";

/** How long a wave takes to cross the whole art, in milliseconds. */
export const STORM_MS: Record<StormKind, number> = { reveal: 1100, ripple: 650 };

/** Width of the scrambled ring, as a share of the longest distance in the art. */
const BAND: Record<StormKind, number> = { reveal: 0.24, ripple: 0.11 };

/** The ring is never thinner than this, in line heights: a small logo still shows it. */
const MIN_BAND = 1.6;

/** How far a cell may lag or lead the ring, as a share of the longest distance. */
const JITTER = 0.09;

/** A scrambled cell keeps its character this long, in milliseconds. */
const FLICKER_MS = 55;

/** One character of the art that carries ink. */
interface InkCell {
  /** Index of the character in the art string. */
  index: number;
  column: number;
  row: number;
  /** Fixed offset of this cell from the ring, between -1 and 1. */
  lag: number;
}

/** The art, read once per wave. */
export interface StormPlan {
  art: string;
  columns: number;
  rows: number;
  cells: InkCell[];
}

/** Where the wave starts, in cells from the top left corner of the art (fractions allowed). */
export interface StormOrigin {
  column: number;
  row: number;
}

export interface StormFrame {
  /** The art as it shows now: hidden and scrambled cells are spaces. */
  base: string;
  /** Only the scrambled cells, in place; everything else is a space. */
  spark: string;
  /** `true` when the wave has passed: `base` is the art again. */
  done: boolean;
}

/** A small integer hash: the same cell always gets the same lag and characters. */
function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

export function planStorm(art: string): StormPlan {
  const cells: InkCell[] = [];
  let column = 0;
  let row = 0;
  let columns = 0;

  for (let index = 0; index < art.length; index++) {
    const char = art[index];
    if (char === "\n") {
      row++;
      column = 0;
      continue;
    }
    if (char !== " ") {
      cells.push({ index, column, row, lag: (mix(index, 7) / 0xffffffff) * 2 - 1 });
    }
    column++;
    columns = Math.max(columns, column);
  }

  return { art, columns, rows: art.length > 0 ? row + 1 : 0, cells };
}

/** The centre of the art: where the reveal starts. */
export function centreOf(plan: StormPlan): StormOrigin {
  return { column: plan.columns / 2, row: plan.rows / 2 };
}

/**
 * Distance between two cells in line heights. A cell is `CELL_ASPECT` as wide
 * as it is tall, so the ring is round on screen, not stretched.
 */
function distance(cell: InkCell, origin: StormOrigin): number {
  return Math.hypot((cell.column + 0.5 - origin.column) * CELL_ASPECT, cell.row + 0.5 - origin.row);
}

/** The art `elapsed` milliseconds after a wave of `kind` started at `origin`. */
export function stormFrame(
  plan: StormPlan,
  kind: StormKind,
  origin: StormOrigin,
  elapsed: number,
): StormFrame {
  const duration = STORM_MS[kind];
  if (elapsed >= duration || plan.cells.length === 0) {
    return { base: plan.art, spark: plan.art.replace(/[^\n]/g, " "), done: true };
  }

  // The longest distance from the origin decides the size of everything else.
  let reach = 0;
  for (const cell of plan.cells) reach = Math.max(reach, distance(cell, origin));
  const band = Math.max(reach * BAND[kind], MIN_BAND);
  const jitter = reach * JITTER;
  // The ring starts just before the origin and has left the farthest cell,
  // lag and all, when the time is up.
  const span = reach + band + 2 * jitter;
  const front = (elapsed / duration) * span - jitter;

  const base = plan.art.split("");
  const spark = plan.art.replace(/[^\n]/g, " ").split("");
  const tick = Math.floor(elapsed / FLICKER_MS);

  for (const cell of plan.cells) {
    const at = distance(cell, origin) + cell.lag * jitter;
    if (at > front) {
      // The ring has not come yet.
      if (kind === "reveal") base[cell.index] = " ";
    } else if (at > front - band) {
      base[cell.index] = " ";
      spark[cell.index] = SOLID_GLYPHS[mix(cell.index, tick) % SOLID_GLYPHS.length];
    }
  }

  return { base: base.join(""), spark: spark.join(""), done: false };
}
