import { describe, expect, test } from "vite-plus/test";

import { POOL_DEPTH, floorAt, poolUnder } from "#/lib/water-stage";

const card = { left: 56, top: 600, width: 1000, height: 180 };

describe("the pool", () => {
  test("lies right under the card, as wide as it", () => {
    const pool = poolUnder(card, 160);

    expect(pool.top).toBe(card.top + card.height);
    expect(pool.left).toBe(card.left);
    expect(pool.width).toBe(card.width);
    expect(pool.height).toBe(160);
  });

  test("is no deeper than the room under the card, nor than its own depth", () => {
    expect(poolUnder(card, 40).height).toBe(40);
    expect(poolUnder(card, 900).height).toBe(POOL_DEPTH);
    expect(poolUnder(card, -20).height).toBe(0);
  });
});

describe("the water", () => {
  test("draws a circle on it as an ellipse, flatter toward the card", () => {
    const across = (v: number) => 1 / (floorAt(1, v).x - floorAt(0, v).x);
    const down = (v: number) => 1 / (floorAt(0, v).z - floorAt(0, v + 1).z);
    const flatness = (v: number) => down(v) / across(v);

    expect(flatness(5)).toBeLessThan(flatness(120));
    expect(flatness(120)).toBeLessThan(1);
  });
});
