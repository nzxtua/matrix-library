import { describe, expect, test } from "vite-plus/test";

import { maskFromRgba, signedArea, traceShapes } from "#/lib/logo-trace";
import type { InkMask, Point } from "#/lib/logo-trace";

/** A mask inked wherever `inside` says so, sampled at pixel centres. */
function paint(width: number, height: number, inside: (x: number, y: number) => boolean): InkMask {
  const ink = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) ink[y * width + x] = inside(x + 0.5, y + 0.5) ? 1 : 0;
  }
  return { width, height, ink };
}

const disc = (cx: number, cy: number, r: number) => (x: number, y: number) =>
  (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

const square = (left: number, top: number, size: number) => (x: number, y: number) =>
  x >= left && x < left + size && y >= top && y < top + size;

const distance = ([x, y]: Point, cx: number, cy: number) => Math.hypot(x - cx, y - cy);

describe("traceShapes", () => {
  test("two separate blobs give two shapes without holes", () => {
    const a = square(4, 4, 10);
    const b = square(24, 6, 10);
    const shapes = traceShapes(paint(40, 20, (x, y) => a(x, y) || b(x, y)));

    expect(shapes).toHaveLength(2);
    for (const shape of shapes) expect(shape.holes).toHaveLength(0);
  });

  test("a ring gives one shape with one hole inside it", () => {
    const outer = disc(30, 30, 20);
    const inner = disc(30, 30, 10);
    const shapes = traceShapes(paint(60, 60, (x, y) => outer(x, y) && !inner(x, y)));

    expect(shapes).toHaveLength(1);
    const [ring] = shapes;
    expect(ring.holes).toHaveLength(1);
    // Holes wind the other way round, as Three.js shapes expect.
    expect(Math.sign(signedArea(ring.outer))).toBe(-Math.sign(signedArea(ring.holes[0])));
    for (const point of ring.holes[0]) expect(distance(point, 30, 30)).toBeLessThan(12);
  });

  test("an island inside a hole is its own shape", () => {
    const outer = disc(30, 30, 20);
    const inner = disc(30, 30, 10);
    const island = disc(30, 30, 4);
    const shapes = traceShapes(
      paint(60, 60, (x, y) => (outer(x, y) && !inner(x, y)) || island(x, y)),
    );

    expect(shapes).toHaveLength(2);
    expect(shapes.map((shape) => shape.holes.length).sort((a, b) => a - b)).toEqual([0, 1]);
  });

  test("the outline follows a round edge", () => {
    const [shape] = traceShapes(paint(80, 80, disc(40, 40, 30)));

    for (const point of shape.outer) {
      expect(Math.abs(distance(point, 40, 40) - 30)).toBeLessThanOrEqual(0.35 + 0.75);
    }
    expect(Math.abs(signedArea(shape.outer))).toBeGreaterThan(Math.PI * 900 * 0.98);
    expect(Math.abs(signedArea(shape.outer))).toBeLessThan(Math.PI * 900 * 1.02);
  });

  test("ink that touches the edge of the image still closes", () => {
    const shapes = traceShapes(paint(20, 20, () => true));

    expect(shapes).toHaveLength(1);
    expect(Math.abs(signedArea(shapes[0].outer))).toBeGreaterThan(350);
  });

  test("squares that touch at a corner are one piece of ink", () => {
    const a = square(4, 4, 6);
    const b = square(10, 10, 6);
    expect(traceShapes(paint(20, 20, (x, y) => a(x, y) || b(x, y)))).toHaveLength(1);
  });

  test("faint squares that touch at a corner stay two pieces", () => {
    const a = square(4, 4, 6);
    const b = square(10, 10, 6);
    const mask = paint(20, 20, (x, y) => a(x, y) || b(x, y));
    // Between them the ink is too faint to bridge the corner.
    const faint = { ...mask, ink: mask.ink.map((ink) => ink * 0.6) };
    expect(traceShapes(faint)).toHaveLength(2);
  });

  test("a speck smaller than minArea is dropped", () => {
    expect(traceShapes(paint(20, 20, square(8, 8, 3)))).toEqual([]);
  });

  test("an empty mask gives nothing", () => {
    expect(traceShapes(paint(20, 20, () => false))).toEqual([]);
  });
});

describe("maskFromRgba", () => {
  /** A 4×4 RGBA image: `inner` on the 2×2 centre, `outer` everywhere else. */
  function image(outer: number[], inner: number[]): Uint8ClampedArray {
    const data = new Uint8ClampedArray(4 * 4 * 4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const centre = x >= 1 && x <= 2 && y >= 1 && y <= 2;
        data.set(centre ? inner : outer, (y * 4 + x) * 4);
      }
    }
    return data;
  }

  const centreInk = (mask: InkMask) => mask.ink[1 * 4 + 1];
  const cornerInk = (mask: InkMask) => mask.ink[0];

  test("a cut-out image is inked by its alpha", () => {
    const mask = maskFromRgba(image([0, 0, 0, 0], [0, 0, 0, 255]), 4, 4);

    expect(centreInk(mask)).toBeCloseTo(1);
    expect(cornerInk(mask)).toBeCloseTo(0);
  });

  test("an opaque image is inked where it differs from its corners", () => {
    const blackOnWhite = maskFromRgba(image([255, 255, 255, 255], [0, 0, 0, 255]), 4, 4);
    const whiteOnBlack = maskFromRgba(image([0, 0, 0, 255], [255, 255, 255, 255]), 4, 4);

    for (const mask of [blackOnWhite, whiteOnBlack]) {
      expect(centreInk(mask)).toBeCloseTo(1);
      expect(cornerInk(mask)).toBeCloseTo(0);
    }
  });
});
