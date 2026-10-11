import { describe, expect, test } from "vite-plus/test";

import { wordmarkRows } from "#/lib/site";

describe("wordmarkRows", () => {
  test("a slash sets the break", () => {
    expect(wordmarkRows("Spedion / integration")).toEqual(["Spedion", "integration"]);
    expect(wordmarkRows("A B C / D")).toEqual(["A B C", "D"]);
  });

  test("only the first slash breaks the rows", () => {
    expect(wordmarkRows("one / two / three")).toEqual(["one", "two three"]);
  });

  test("without a slash, the rows are as even as the spaces allow", () => {
    expect(wordmarkRows("Spedion integration")).toEqual(["Spedion", "integration"]);
    expect(wordmarkRows("the quick brown fox")).toEqual(["the quick", "brown fox"]);
  });

  test("one word is one row, nothing is none", () => {
    expect(wordmarkRows("  Spedion ")).toEqual(["Spedion"]);
    expect(wordmarkRows("   ")).toEqual([]);
    expect(wordmarkRows(" / ")).toEqual([]);
  });
});
