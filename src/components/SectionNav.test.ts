import { describe, expect, test } from "vite-plus/test";

import { outlineOf } from "#/components/SectionNav";
import { parseMarkdown } from "#/lib/markdown";

/** `kind code` of every row, in order. */
function shape(source: string): string[] {
  return outlineOf(parseMarkdown(source)).rows.map((row) =>
    [row.kind, row.code ?? "-", row.meta ? "meta" : "bare"].join(" "),
  );
}

describe("outlineOf", () => {
  test("a document with a title, parts and sections", () => {
    const rows = shape(`# Field notes

Intro paragraph.

# Part A. Overlay

## A1. Product intent

Text.

# Tools

## Plain heading

Text.
`);

    expect(rows).toEqual([
      // The title has text under it: it gets a reading time.
      "title - meta",
      // A part with a code keeps it. A heading alone has nothing to read.
      "part Part A bare",
      "section A1 meta",
      // A part without a code gets its place among the parts; the title is not counted.
      "part 02 bare",
      "section - meta",
    ]);
  });

  test("top headings without sections under them are rows, not eyebrows", () => {
    const rows = shape(`# One

Text.

# Two

Text.

# Three

Text.
`);

    expect(rows).toEqual(["title - meta", "section - meta", "section - meta"]);
  });

  test("a document that starts with a section has no title row", () => {
    const rows = shape(`## 1.1 First

Text.

## 1.2 Second

Text.
`);

    expect(rows).toEqual(["section 1.1 meta", "section 1.2 meta"]);
  });

  test("the chip column is as wide as the longest section code, within a limit", () => {
    const codes = (source: string) => outlineOf(parseMarkdown(source)).codeLength;

    expect(codes("# T\n\n## A1. One\n\nx\n\n## A12. Two\n\nx\n")).toBe(3);
    // The code of a part is not a chip.
    expect(codes("# T\n\n# Part A. P\n\n## Plain\n\nx\n")).toBe(0);
    expect(codes("# T\n\n## 10.11.12.13 Deep\n\nx\n")).toBeLessThanOrEqual(8);
  });

  test("a document without headings has no rows", () => {
    expect(outlineOf(parseMarkdown("Just a paragraph.\n")).rows).toEqual([]);
  });
});
