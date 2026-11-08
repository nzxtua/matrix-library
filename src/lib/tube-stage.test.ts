import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, test } from "vite-plus/test";

import { rgbOf } from "#/lib/three-ink";
import { CAMERA_Z, FOV, PARALLAX, place, shelfWidth } from "#/lib/tube-stage";
import type { Box, Viewport } from "#/lib/tube-stage";

/** Where a room point lands on screen, in CSS pixels, for the resting camera. */
function onScreen(view: Viewport, x: number, y: number): { x: number; y: number } {
  const camera = new PerspectiveCamera(FOV, view.width / view.height, 0.1, 60);
  camera.position.set(0, 0, CAMERA_Z);
  camera.updateMatrixWorld();
  const point = new Vector3(x, y, 0).project(camera);
  return { x: ((point.x + 1) / 2) * view.width, y: ((1 - point.y) / 2) * view.height };
}

const wide: Viewport = { width: 1440, height: 900 };
const head: Box = { left: 144, top: 60, width: 1152, height: 330 };

describe("the tube stage", () => {
  test("stands the shelf in the right part of the header on a wide screen", () => {
    const shelf = place(head, wide, 0, 3);
    const centre = onScreen(wide, shelf.x, shelf.y);

    expect(centre.x).toBeGreaterThan(head.left + head.width * 0.6);
    expect(centre.x).toBeLessThan(head.left + head.width);
    expect(centre.y).toBeGreaterThan(head.top);
    expect(centre.y).toBeLessThan(head.top + head.height);
  });

  test("keeps the shelf inside its share of the screen, however many documents", () => {
    for (const count of [2, 5, 12, 30]) {
      const shelf = place(head, wide, 0, count);
      const half = (shelfWidth(count) * shelf.scale) / 2;
      const left = onScreen(wide, shelf.x - half, shelf.y);
      const right = onScreen(wide, shelf.x + half, shelf.y);

      expect(right.x - left.x).toBeLessThanOrEqual(520 + 1);
      expect(right.x).toBeLessThanOrEqual(wide.width);
    }
  });

  test("scrolls slower than the page: it reads as further away", () => {
    const top = onScreen(wide, place(head, wide, 0, 3).x, place(head, wide, 0, 3).y);
    const down = place(head, wide, 200, 3);
    const moved = top.y - onScreen(wide, down.x, down.y).y;

    expect(moved).toBeCloseTo(200 * PARALLAX, 3);
    expect(moved).toBeLessThan(200);
  });

  test("dims the shelf on a phone, where the title is set over it", () => {
    const phone: Viewport = { width: 390, height: 844 };
    const narrowHead: Box = { left: 20, top: 50, width: 350, height: 220 };

    expect(place(narrowHead, phone, 0, 3).power).toBeLessThan(place(head, wide, 0, 3).power);
  });

  test("reads a CSS colour token, and falls back on a broken one", () => {
    expect(rgbOf(" 204 255 0", [0, 0, 0])).toEqual([0.8, 1, 0]);
    expect(rgbOf("", [0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
    expect(rgbOf("var(--x)", [0.1, 0.2, 0.3])).toEqual([0.1, 0.2, 0.3]);
  });
});
