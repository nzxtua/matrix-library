import { describe, expect, test } from "vite-plus/test";

import { hopIndex, sectionMarkdown } from "#/components/Spotlight";
import { parseMarkdown } from "#/lib/markdown";

describe("hopIndex", () => {
  test("next goes one section down and stops after the last", () => {
    expect(hopIndex(5, 2, 1, false)).toBe(3);
    expect(hopIndex(5, 2, 1, true)).toBe(3);
    expect(hopIndex(5, 4, 1, false)).toBe(-1);
  });

  test("previous from inside a section goes to its start first", () => {
    expect(hopIndex(5, 2, -1, true)).toBe(2);
    expect(hopIndex(5, 2, -1, false)).toBe(1);
  });

  test("there is nothing before the first section", () => {
    expect(hopIndex(5, 0, -1, false)).toBe(-1);
    expect(hopIndex(5, -1, -1, false)).toBe(-1);
  });

  test("above the first section, next goes to it", () => {
    expect(hopIndex(5, -1, 1, false)).toBe(0);
  });

  test("a document without sections has nowhere to hop", () => {
    expect(hopIndex(0, -1, 1, false)).toBe(-1);
  });
});

const SOURCE = `# Title

Intro.

## One

First paragraph of one.

- item a
- item b

A paragraph after the list.

\`\`\`js
const x = 1;
\`\`\`

| key | value |
| --- | ----- |
| a   | 1     |

## Two

Text of two.
`;

describe("sectionMarkdown", () => {
  const doc = parseMarkdown(SOURCE);
  const one = doc.sections.find((section) => section.title === "One");

  test("pasted back, the section is the same blocks", () => {
    if (!one) throw new Error("no section One");
    const copied = parseMarkdown(sectionMarkdown(doc, one.id));
    const original = doc.blocks.filter((block) => block.sectionId === one.id);
    expect(copied.blocks.map((block) => [block.kind, block.text])).toEqual(
      original.map((block) => [block.kind, block.text]),
    );
  });

  test("it ends where the next section starts", () => {
    if (!one) throw new Error("no section One");
    expect(sectionMarkdown(doc, one.id)).not.toContain("Text of two");
  });

  test("an unknown section copies nothing", () => {
    expect(sectionMarkdown(doc, "nowhere")).toBe("");
  });
});
