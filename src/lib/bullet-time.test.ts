import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, test } from "vite-plus/test";

import { CAMERA_Z, FOV, FROZEN, RELEASE_S, SLOW_S, stageOf, timeScale } from "#/lib/bullet-time";
import type { Box, Viewport } from "#/lib/bullet-time";

/** Where a room point lands on screen, in CSS pixels, for the camera of the scene. */
function onScreen(view: Viewport, x: number, y: number): { x: number; y: number } {
  const camera = new PerspectiveCamera(FOV, view.width / view.height, 0.1, 60);
  camera.position.set(0, 0, CAMERA_Z);
  camera.updateMatrixWorld();
  const point = new Vector3(x, y, 0).project(camera);
  return { x: ((point.x + 1) / 2) * view.width, y: ((1 - point.y) / 2) * view.height };
}

const wide: Viewport = { width: 1440, height: 900 };
const header: Box = { left: 56, top: 150, width: 1000, height: 260 };

describe("the scene", () => {
  test("stands on the title block, as large as it, wherever the page is scrolled", () => {
    for (const scrollY of [0, 120]) {
      const stage = stageOf(header, wide, scrollY);
      const topLeft = onScreen(wide, stage.x - stage.width / 2, stage.y + stage.height / 2);
      const bottomRight = onScreen(wide, stage.x + stage.width / 2, stage.y - stage.height / 2);

      expect(topLeft.x).toBeCloseTo(header.left, 3);
      expect(topLeft.y).toBeCloseTo(header.top - scrollY, 3);
      expect(bottomRight.x).toBeCloseTo(header.left + header.width, 3);
      expect(bottomRight.y).toBeCloseTo(header.top + header.height - scrollY, 3);
    }
  });

  test("is lit at the top of the page and dark once the title block has gone", () => {
    expect(stageOf(header, wide, 0).power).toBe(1);
    expect(stageOf(header, wide, 400).power).toBeGreaterThan(0);
    expect(stageOf(header, wide, 400).power).toBeLessThan(1);
    expect(stageOf(header, wide, 1600).power).toBe(0);
  });
});

describe("bullet time", () => {
  test("runs at full speed right after time is let go", () => {
    expect(timeScale(0)).toBe(1);
    expect(timeScale(RELEASE_S * 0.9)).toBe(1);
  });

  test("slows down without a jump, and stands still again after it", () => {
    const samples = Array.from({ length: 40 }, (_, i) => timeScale(RELEASE_S + (i / 39) * SLOW_S));
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i]!).toBeLessThanOrEqual(samples[i - 1]!);
      expect(samples[i - 1]! - samples[i]!).toBeLessThan(0.15);
    }
    expect(timeScale(RELEASE_S + SLOW_S + 5)).toBe(FROZEN);
  });

  test("holds the arrival longer than a click", () => {
    expect(timeScale(1.2, 1.5)).toBe(1);
    expect(timeScale(1.2)).toBeLessThan(1);
  });
});
