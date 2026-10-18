import { describe, expect, test } from "vite-plus/test";

import { splitHeading } from "#/components/Markdown";
import { parseMarkdown, plainText } from "#/lib/markdown";

/** The heading block with this text, split the way the page shows it. */
function split(source: string, text: string) {
  const document = parseMarkdown(source);
  const block = document.blocks.find((candidate) => candidate.heading?.text === text);
  if (!block?.heading) throw new Error(`no heading "${text}"`);
  const section = document.sections.find((candidate) => candidate.id === block.heading?.id);
  const { code, tokens } = splitHeading(block, section);
  return { code, shown: plainText(tokens) };
}

describe("the chip of a heading", () => {
  test("the code leaves the title and nothing else does", () => {
    expect(split("## A1. Product intent", "A1. Product intent")).toEqual({
      code: "A1",
      shown: "Product intent",
    });
    expect(split("# Part A. Overlay", "Part A. Overlay")).toEqual({
      code: "Part A",
      shown: "Overlay",
    });
    expect(split("## 3.2 Numbers", "3.2 Numbers")).toEqual({ code: "3.2", shown: "Numbers" });
  });

  test("markup after the code stays in the title", () => {
    expect(split("## B2 - The `env` files", "B2 - The env files")).toEqual({
      code: "B2",
      shown: "The env files",
    });
    // The title starts with markup: the text token before it holds only the code.
    expect(split("## A1. `develop` again", "A1. develop again")).toEqual({
      code: "A1",
      shown: "develop again",
    });
  });

  test("a code inside markup is not lifted: the heading keeps every word", () => {
    expect(split("## **A1.** Product intent", "A1. Product intent")).toEqual({
      code: undefined,
      shown: "A1. Product intent",
    });
    expect(split("## **A1. Product** intent", "A1. Product intent")).toEqual({
      code: undefined,
      shown: "A1. Product intent",
    });
  });

  test("a heading without a code is shown whole", () => {
    expect(split("## Plain heading", "Plain heading")).toEqual({
      code: undefined,
      shown: "Plain heading",
    });
  });
});
