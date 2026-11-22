/**
 * Traces the ink of a picture into outlines: shapes with holes, ready to be
 * extruded. No DOM and no `three`: the input is a plain mask of ink.
 *
 * The outline runs where the ink crosses `threshold`, found between pixel
 * centres by marching squares with linear interpolation, so it is finer than
 * a pixel. It is then thinned to `tolerance`.
 */

/** A point in mask pixels, y down. */
export type Point = [x: number, y: number];

/** How much ink each pixel holds, 0..1, row by row. */
export interface InkMask {
  width: number;
  height: number;
  ink: Float32Array;
}

/** One piece of ink: its outline and the outlines of its holes. */
export interface TracedShape {
  /** Winds with a positive `signedArea`. */
  outer: Point[];
  /** Each winds with a negative `signedArea`. */
  holes: Point[][];
}

export interface TraceOptions {
  /** Ink at or above this is inside. */
  threshold?: number;
  /** The thinned outline stays this close to the traced one, in pixels. */
  tolerance?: number;
  /** Outlines enclosing less than this, in square pixels, are specks. */
  minArea?: number;
}

/** The shoelace area of a closed outline, in mask coordinates. */
export function signedArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    sum += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  }
  return sum / 2;
}

const luminance = (data: ArrayLike<number>, i: number) =>
  (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;

/**
 * The ink of an RGBA picture. A cut-out (any see-through pixel) is inked by
 * its alpha. An opaque picture has no shape of its own: its ink is how far
 * each pixel is from the colour of its corners, the background.
 */
export function maskFromRgba(data: ArrayLike<number>, width: number, height: number): InkMask {
  const count = width * height;
  const ink = new Float32Array(count);

  let cutout = false;
  for (let p = 0; p < count; p++) {
    if (data[p * 4 + 3] < 250) {
      cutout = true;
      break;
    }
  }

  if (cutout) {
    for (let p = 0; p < count; p++) ink[p] = data[p * 4 + 3] / 255;
    return { width, height, ink };
  }

  const corners = [0, width - 1, (height - 1) * width, height * width - 1];
  const background = corners.reduce((sum, p) => sum + luminance(data, p * 4), 0) / 4;
  const reach = Math.max(background, 1 - background, 1e-3);
  for (let p = 0; p < count; p++) {
    ink[p] = Math.min(1, Math.abs(luminance(data, p * 4) - background) / reach);
  }
  return { width, height, ink };
}

/** Edges of a cell: top, right, bottom, left. */
type Edge = 0 | 1 | 2 | 3;
const [TOP, RIGHT, BOTTOM, LEFT] = [0, 1, 2, 3] as const;

/**
 * The edge pairs each corner case joins. Corner bits: top left 8, top right
 * 4, bottom right 2, bottom left 1. The two saddles (5, 10) are settled by
 * the ink at the centre of the cell.
 */
const CASES: (Edge[][] | null)[] = [
  [],
  [[BOTTOM, LEFT]],
  [[RIGHT, BOTTOM]],
  [[LEFT, RIGHT]],
  [[TOP, RIGHT]],
  null,
  [[TOP, BOTTOM]],
  [[TOP, LEFT]],
  [[TOP, LEFT]],
  [[TOP, BOTTOM]],
  null,
  [[TOP, RIGHT]],
  [[LEFT, RIGHT]],
  [[RIGHT, BOTTOM]],
  [[BOTTOM, LEFT]],
  [],
];

const SADDLE_TOP_RIGHT: Edge[][] = [
  [TOP, RIGHT],
  [BOTTOM, LEFT],
];
const SADDLE_TOP_LEFT: Edge[][] = [
  [TOP, LEFT],
  [RIGHT, BOTTOM],
];

/** Closed loops where the ink crosses `threshold`. */
function marchingSquares(mask: InkMask, threshold: number): Point[][] {
  const { width, height, ink } = mask;
  // One ring of empty samples around the picture, so ink at its edge closes.
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : ink[y * width + x];

  // Every crossing sits on an edge between two samples, and is known by the
  // id of that edge: horizontal edges right of sample (x, y) are even, the
  // vertical ones below it odd. Typed arrays, not maps: a 640 px logo has
  // hundreds of thousands of cells.
  const stride = width + 2;
  const count = (height + 2) * stride * 2;
  const horizontal = (x: number, y: number) => ((y + 1) * stride + (x + 1)) * 2;
  const vertical = (x: number, y: number) => ((y + 1) * stride + (x + 1)) * 2 + 1;

  const pointX = new Float32Array(count);
  const pointY = new Float32Array(count);
  /** The two crossings each crossing is joined to; -1 while unknown. */
  const linkA = new Int32Array(count).fill(-1);
  const linkB = new Int32Array(count).fill(-1);
  /** Every crossing, in the order it was found. */
  const found: number[] = [];

  const place = (id: number, x: number, y: number) => {
    if (linkA[id] >= 0) return;
    pointX[id] = x;
    pointY[id] = y;
  };
  const link = (from: number, to: number) => {
    if (linkA[from] < 0) {
      linkA[from] = to;
      found.push(from);
    } else linkB[from] = to;
  };
  const join = (a: number, b: number) => {
    link(a, b);
    link(b, a);
  };

  const cross = (a: number, b: number) => (threshold - a) / (b - a);

  for (let y = -1; y < height; y++) {
    for (let x = -1; x < width; x++) {
      const tl = at(x, y);
      const tr = at(x + 1, y);
      const br = at(x + 1, y + 1);
      const bl = at(x, y + 1);
      const index =
        (tl >= threshold ? 8 : 0) |
        (tr >= threshold ? 4 : 0) |
        (br >= threshold ? 2 : 0) |
        (bl >= threshold ? 1 : 0);
      if (index === 0 || index === 15) continue;

      let pairs = CASES[index];
      if (!pairs) {
        const centreInside = (tl + tr + br + bl) / 4 >= threshold;
        // Case 5: top right and bottom left are inked; case 10: the other two.
        const joinTopRight = (index === 5) !== centreInside;
        pairs = joinTopRight ? SADDLE_TOP_RIGHT : SADDLE_TOP_LEFT;
      }

      // Samples sit at pixel centres.
      const cx = x + 0.5;
      const cy = y + 0.5;
      for (const pair of pairs) {
        let ends = 0;
        let first = 0;
        for (const edge of pair) {
          let id: number;
          if (edge === TOP) {
            id = horizontal(x, y);
            place(id, cx + cross(tl, tr), cy);
          } else if (edge === RIGHT) {
            id = vertical(x + 1, y);
            place(id, cx + 1, cy + cross(tr, br));
          } else if (edge === BOTTOM) {
            id = horizontal(x, y + 1);
            place(id, cx + cross(bl, br), cy + 1);
          } else {
            id = vertical(x, y);
            place(id, cx, cy + cross(tl, bl));
          }
          if (ends++ === 0) first = id;
          else join(first, id);
        }
      }
    }
  }

  // Every crossing has exactly two links: the graph is a set of cycles.
  const loops: Point[][] = [];
  const seen = new Uint8Array(count);
  for (const start of found) {
    if (seen[start]) continue;
    const loop: Point[] = [];
    let previous = -1;
    let current = start;
    while (!seen[current]) {
      seen[current] = 1;
      loop.push([pointX[current], pointY[current]]);
      const next = linkA[current] !== previous ? linkA[current] : linkB[current];
      previous = current;
      current = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Squared distance from `p` to the segment `a`–`b`. */
function segmentDistance2(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  let t = length2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ex = a[0] + t * dx - p[0];
  const ey = a[1] + t * dy - p[1];
  return ex * ex + ey * ey;
}

/** Ramer–Douglas–Peucker on `points[from..to]`: which points to keep. */
function thin(points: Point[], from: number, to: number, tolerance2: number, keep: Uint8Array) {
  const stack: [number, number][] = [[from, to]];
  while (stack.length > 0) {
    const [first, last] = stack.pop() as [number, number];
    let worst = -1;
    let worstDistance = tolerance2;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance2(points[i], points[first], points[last]);
      if (d > worstDistance) {
        worst = i;
        worstDistance = d;
      }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push([first, worst], [worst, last]);
  }
}

/** A closed loop, thinned so it stays within `tolerance` of itself. */
function simplifyLoop(loop: Point[], tolerance: number): Point[] {
  if (loop.length <= 4) return loop;
  // Split the loop at the point farthest from its first one.
  let far = 0;
  let farDistance = -1;
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2;
    if (d > farDistance) {
      far = i;
      farDistance = d;
    }
  }
  const closed = [...loop, loop[0]];
  const keep = new Uint8Array(closed.length);
  keep[0] = 1;
  keep[far] = 1;
  const tolerance2 = tolerance * tolerance;
  thin(closed, 0, far, tolerance2, keep);
  thin(closed, far, closed.length - 1, tolerance2, keep);
  return loop.filter((_, i) => keep[i] === 1);
}

/** Even-odd: is `p` inside the closed outline `loop`? */
function contains(loop: Point[], [px, py]: Point): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The ink of `mask` as shapes with holes, the largest first. */
export function traceShapes(mask: InkMask, options: TraceOptions = {}): TracedShape[] {
  const { threshold = 0.5, tolerance = 0.35, minArea = 16 } = options;

  const loops = marchingSquares(mask, threshold)
    .map((points) => ({ points, area: Math.abs(signedArea(points)) }))
    .filter((loop) => loop.area >= minArea)
    .map((loop) => ({ ...loop, points: simplifyLoop(loop.points, tolerance) }));

  // Loops never cross, so one point of a loop tells what it lies inside.
  const parents = loops.map((loop) =>
    loops.filter((other) => other !== loop && contains(other.points, loop.points[0])),
  );

  const shapes = new Map<(typeof loops)[number], TracedShape>();
  loops.forEach((loop, index) => {
    if (parents[index].length % 2 === 1) return;
    const outer = signedArea(loop.points) > 0 ? loop.points : [...loop.points].reverse();
    shapes.set(loop, { outer, holes: [] });
  });

  loops.forEach((loop, index) => {
    if (parents[index].length % 2 === 0) return;
    // A hole belongs to the smallest outline around it.
    const owner = parents[index].reduce((best, other) => (other.area < best.area ? other : best));
    const hole = signedArea(loop.points) < 0 ? loop.points : [...loop.points].reverse();
    shapes.get(owner)?.holes.push(hole);
  });

  return [...shapes.entries()].sort(([a], [b]) => b.area - a.area).map(([, shape]) => shape);
}
