import { describe, expect, test } from "vite-plus/test";

import { CELL_ASPECT, fitColumns } from "#/lib/ascii-art";

/** Height of a character when `columns` of them fill `width` pixels. */
const glyph = (width: number, columns: number) => width / columns / CELL_ASPECT;

describe("fitColumns", () => {
  test("a wide box gets every column", () => {
    expect(fitColumns(264, 76, 4.4)).toBe(76);
  });

  test("a narrow box gets fewer columns, and its characters stay readable", () => {
    const columns = fitColumns(144, 76, 4.4);

    expect(columns).toBeLessThan(76);
    expect(glyph(144, columns)).toBeGreaterThanOrEqual(4.4);
    // One more column would be too small: the box is used in full.
    expect(glyph(144, columns + 1)).toBeLessThan(4.4);
  });

  test("a tiny box still gets enough columns to read as a picture", () => {
    expect(fitColumns(20, 76, 4.4)).toBe(24);
    // But never more than the caller allows.
    expect(fitColumns(20, 12, 4.4)).toBe(12);
  });

  test("a box without a width gets nothing", () => {
    expect(fitColumns(0, 76, 4.4)).toBe(0);
    expect(fitColumns(Number.NaN, 76, 4.4)).toBe(0);
  });
});
