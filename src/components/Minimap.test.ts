import { describe, expect, it } from "vite-plus/test";

import {
  keyTarget,
  scaleOf,
  scrubTarget,
  sectionAt,
  windowHeight,
  windowTop,
} from "#/components/Minimap";
import type { Geometry } from "#/components/Minimap";

/** A long document: 40 viewports. */
const long: Geometry = { strip: 900, page: 36000, viewport: 900 };
/** A document so long that the window would be thinner than a hair. */
const endless: Geometry = { strip: 600, page: 900000, viewport: 600 };
/** A document that fits the viewport: nothing to scroll. */
const short: Geometry = { strip: 900, page: 900, viewport: 900 };

const maxScroll = (geometry: Geometry) => geometry.page - geometry.viewport;
const progressAt = (geometry: Geometry, scrollTop: number) => scrollTop / maxScroll(geometry);

describe("the window", () => {
  it("covers on the strip exactly what the viewport covers on the page", () => {
    const scrollTop = 12345;
    const scale = scaleOf(long);
    const top = windowTop(long, progressAt(long, scrollTop));
    // The same linear map as the bars: page y -> strip y.
    const origin = windowTop(long, 0);
    expect(top - origin).toBeCloseTo(scrollTop * scale, 6);
    expect(windowHeight(long)).toBeCloseTo(long.viewport * scale, 6);
  });

  it("ends at the end of the map when the page is at its end", () => {
    const origin = windowTop(long, 0);
    const bottom = windowTop(long, 1) + windowHeight(long);
    expect(bottom - origin).toBeCloseTo(long.page * scaleOf(long), 6);
    expect(bottom).toBeLessThanOrEqual(long.strip);
  });

  it("stays large enough to take in an endless document, and stays on the strip", () => {
    expect(endless.viewport * scaleOf(endless)).toBeLessThan(1);
    expect(windowHeight(endless)).toBeGreaterThanOrEqual(14);
    expect(windowTop(endless, 1) + windowHeight(endless)).toBeLessThanOrEqual(endless.strip);
    expect(windowTop(endless, 0)).toBeGreaterThanOrEqual(0);
  });

  it("is the whole map when the document fits the viewport", () => {
    expect(windowTop(short, 0.5)).toBe(windowTop(short, 0));
    expect(windowTop(short, 0) + windowHeight(short)).toBeLessThanOrEqual(short.strip);
  });
});

describe("scrubbing", () => {
  it("puts the middle of the window under a click", () => {
    for (const geometry of [long, endless]) {
      const y = geometry.strip * 0.4;
      const half = windowHeight(geometry) / 2;
      const scrollTop = scrubTarget(geometry, y, half);
      const top = windowTop(geometry, progressAt(geometry, scrollTop));
      expect(top + half).toBeCloseTo(y, 6);
    }
  });

  it("keeps the window under the pointer where it was taken", () => {
    const start = windowTop(long, progressAt(long, 9000));
    const grab = 5;
    // Taken 5 px under its top, with no move: the page does not move.
    expect(scrubTarget(long, start + grab, grab)).toBeCloseTo(9000, 6);
    // Dragged 100 px down: the top of the window is 100 px lower.
    const moved = scrubTarget(long, start + grab + 100, grab);
    expect(windowTop(long, progressAt(long, moved))).toBeCloseTo(start + 100, 6);
  });

  it("stops at the two ends of the page", () => {
    expect(scrubTarget(long, -500, 0)).toBe(0);
    expect(scrubTarget(long, 0, windowHeight(long) / 2)).toBe(0);
    expect(scrubTarget(long, long.strip + 500, 0)).toBe(maxScroll(long));
    expect(scrubTarget(long, long.strip, windowHeight(long) / 2)).toBe(maxScroll(long));
  });

  it("does nothing when there is nothing to scroll", () => {
    expect(scrubTarget(short, 450, 0)).toBe(0);
  });
});

describe("slider keys", () => {
  it("go to the two ends", () => {
    expect(keyTarget("Home", long, 20000)).toBe(0);
    expect(keyTarget("End", long, 20000)).toBe(maxScroll(long));
  });

  it("move down the page with the arrows that point down or forward, and back with the others", () => {
    const down = keyTarget("ArrowDown", long, 20000);
    const up = keyTarget("ArrowUp", long, 20000);
    expect(down).toBeGreaterThan(20000);
    expect(up).toBeLessThan(20000);
    expect(keyTarget("ArrowRight", long, 20000)).toBe(down);
    expect(keyTarget("ArrowLeft", long, 20000)).toBe(up);
  });

  it("page by less than a viewport, so a line of context stays, and by more than an arrow", () => {
    const page = keyTarget("PageDown", long, 20000)! - 20000;
    const arrow = keyTarget("ArrowDown", long, 20000)! - 20000;
    expect(page).toBeLessThan(long.viewport);
    expect(page).toBeGreaterThan(arrow);
    expect(20000 - keyTarget("PageUp", long, 20000)!).toBe(page);
  });

  it("never leave the page", () => {
    expect(keyTarget("ArrowUp", long, 10)).toBe(0);
    expect(keyTarget("PageUp", long, 10)).toBe(0);
    expect(keyTarget("ArrowDown", long, maxScroll(long) - 10)).toBe(maxScroll(long));
    expect(keyTarget("PageDown", long, maxScroll(long) - 10)).toBe(maxScroll(long));
    expect(keyTarget("End", short, 0)).toBe(0);
  });

  it("leave every other key alone", () => {
    for (const key of ["Tab", "Enter", " ", "j", "Escape"]) {
      expect(keyTarget(key, long, 20000)).toBeNull();
    }
  });
});

describe("the section under a point of the strip", () => {
  const starts = [20, 100, Number.NaN, 400];

  it("is the last one that starts at or above the point", () => {
    expect(sectionAt(starts, 20)).toBe(0);
    expect(sectionAt(starts, 99)).toBe(0);
    expect(sectionAt(starts, 100)).toBe(1);
    expect(sectionAt(starts, 399)).toBe(1);
    expect(sectionAt(starts, 900)).toBe(3);
  });

  it("is the first section above the first start", () => {
    expect(sectionAt(starts, 0)).toBe(0);
    expect(sectionAt([Number.NaN, 50], 10)).toBe(1);
  });

  it("is none when no section is on the map", () => {
    expect(sectionAt([], 10)).toBe(-1);
    expect(sectionAt([Number.NaN], 10)).toBe(-1);
  });
});
