import { describe, expect, test } from "vite-plus/test";

import { stepIndex } from "#/components/Ruler";

describe("stepIndex", () => {
  test("from a held block, j and k move one block", () => {
    expect(stepIndex(10, 1, 4, -1, false)).toBe(5);
    expect(stepIndex(10, -1, 4, -1, false)).toBe(3);
  });

  test("it stops at the first and the last block", () => {
    expect(stepIndex(10, -1, 0, -1, false)).toBe(0);
    expect(stepIndex(10, 1, 9, -1, false)).toBe(9);
  });

  test("a free band inside a block: j leaves it downward, k upward", () => {
    expect(stepIndex(10, 1, -1, 3, true)).toBe(4);
    expect(stepIndex(10, -1, -1, 3, true)).toBe(2);
  });

  test("a free band in the gap above a block: j takes that block, k the one before", () => {
    expect(stepIndex(10, 1, -1, 3, false)).toBe(3);
    expect(stepIndex(10, -1, -1, 3, false)).toBe(2);
  });

  test("a band below every block takes the last one", () => {
    expect(stepIndex(10, -1, -1, -1, false)).toBe(9);
  });

  test("no blocks, no step", () => {
    expect(stepIndex(0, 1, -1, -1, false)).toBe(-1);
  });
});
