import { describe, expect, test } from "vite-plus/test";

import { nextTerm, placeCard, tallySections } from "#/components/Echo";

const VIEWPORT = { width: 1440, height: 900 };
const CARD = { width: 320, height: 240 };

describe("placeCard", () => {
  test("the card goes under its code when there is room", () => {
    const spot = placeCard({
      anchor: { left: 400, top: 200, bottom: 220 },
      card: CARD,
      viewport: VIEWPORT,
    });
    expect(spot.above).toBe(false);
    expect(spot.y).toBeGreaterThan(220);
  });

  test("near the bottom the card goes above its code and does not cover it", () => {
    const spot = placeCard({
      anchor: { left: 400, top: 800, bottom: 820 },
      card: CARD,
      viewport: VIEWPORT,
    });
    expect(spot.above).toBe(true);
    expect(spot.y + CARD.height).toBeLessThanOrEqual(800);
  });

  test("the dock at the bottom counts as no room", () => {
    const anchor = { left: 400, top: 560, bottom: 580 };
    expect(placeCard({ anchor, card: CARD, viewport: VIEWPORT }).above).toBe(false);
    expect(placeCard({ anchor, card: CARD, viewport: VIEWPORT, clear: 120 }).above).toBe(true);
  });

  test("the card stays inside the viewport sideways", () => {
    const right = placeCard({
      anchor: { left: 1400, top: 200, bottom: 220 },
      card: CARD,
      viewport: VIEWPORT,
    });
    expect(right.x + CARD.width).toBeLessThanOrEqual(VIEWPORT.width);

    const left = placeCard({
      anchor: { left: 2, top: 200, bottom: 220 },
      card: CARD,
      viewport: VIEWPORT,
    });
    expect(left.x).toBeGreaterThan(0);
  });

  test("on a phone narrower than the card it still starts inside the screen", () => {
    const spot = placeCard({
      anchor: { left: 200, top: 200, bottom: 220 },
      card: { width: 366, height: 240 },
      viewport: { width: 390, height: 844 },
    });
    expect(spot.x).toBeGreaterThanOrEqual(0);
    expect(spot.x + 366).toBeLessThanOrEqual(390);
  });

  test("while stepping, the card keeps its column and its side", () => {
    const keep = { x: 500, above: true };
    const spot = placeCard({
      anchor: { left: 100, top: 400, bottom: 420 },
      card: CARD,
      viewport: VIEWPORT,
      keep,
    });
    expect(spot.x).toBe(500);
    expect(spot.above).toBe(true);
  });

  test("a kept side above is given up when there is no room above", () => {
    const spot = placeCard({
      anchor: { left: 100, top: 40, bottom: 60 },
      card: CARD,
      viewport: VIEWPORT,
      keep: { x: 100, above: true },
    });
    expect(spot.above).toBe(false);
  });
});

describe("tallySections", () => {
  const sections = [
    { id: "intro", title: "Intro" },
    { id: "a1", code: "A1", title: "Rules" },
  ];

  test("counts places per section in document order, with the first place of each", () => {
    const tallies = tallySections(["intro", "a1", "a1", "intro", "a1"], sections);
    expect(tallies.map(({ id, count, first }) => ({ id, count, first }))).toEqual([
      { id: "intro", count: 2, first: 0 },
      { id: "a1", count: 3, first: 1 },
    ]);
    expect(tallies[1].code).toBe("A1");
  });

  test("a section the document does not list still gets a row", () => {
    const [tally] = tallySections(["", ""], sections);
    expect(tally).toMatchObject({ id: "", title: "", count: 2, first: 0 });
  });
});

describe("nextTerm", () => {
  const terms = ["alpha", "beta", "gamma"];

  test("a fresh echo takes the first term on screen", () => {
    expect(nextTerm(terms, null, false, 1)).toBe(1);
  });

  test("with nothing on screen it takes the first term", () => {
    expect(nextTerm(terms, null, false, -1)).toBe(0);
  });

  test("pressed again in the same place, it moves on and wraps", () => {
    expect(nextTerm(terms, "alpha", true, 0)).toBe(1);
    expect(nextTerm(terms, "gamma", true, 0)).toBe(0);
  });

  test("an echo from somewhere else starts over in this place", () => {
    expect(nextTerm(terms, "beta", false, 0)).toBe(0);
  });

  test("no terms, nothing to echo", () => {
    expect(nextTerm([], null, false, -1)).toBe(-1);
  });
});
