import { describe, expect, test } from "vite-plus/test";

import { contactParts, metaParts, parseMarkdown, skillParts } from "#/lib/markdown";

const SOURCE = `# Field notes

Intro paragraph.

# Part A. Overlay

## A1. Product intent

Same words.

Same words.

| Key | Value |
| --- | ----- |
| \`a\` | one |

## 3.2 Numbers

Text about \`a\` and \`b\`.

## Plain heading

Last paragraph.
`;

describe("block ids", () => {
  test("are unique, also for blocks with the same text", () => {
    const { blocks } = parseMarkdown(SOURCE);
    const ids = blocks.map((block) => block.id);

    expect(new Set(ids).size).toBe(ids.length);
    const same = blocks.filter((block) => block.text === "Same words.");
    expect(same).toHaveLength(2);
    expect(same[1].id).toBe(`${same[0].id}-2`);
  });

  test("do not change when a block is inserted before", () => {
    const before = parseMarkdown(SOURCE);
    const after = parseMarkdown(
      SOURCE.replace("Intro paragraph.", "New first.\n\nIntro paragraph."),
    );

    expect(after.blocks).toHaveLength(before.blocks.length + 1);
    const idsAfter = new Set(after.blocks.map((block) => block.id));
    for (const block of before.blocks) expect(idsAfter.has(block.id), block.text).toBe(true);
  });

  test("do not change when a block is added after the last one", () => {
    const before = parseMarkdown(SOURCE);
    const after = parseMarkdown(`${SOURCE}\nAppended.\n`);

    expect(after.blocks.slice(0, before.blocks.length).map((block) => block.id)).toEqual(
      before.blocks.map((block) => block.id),
    );
  });

  test("change for the block that was edited, and only for it", () => {
    const before = parseMarkdown(SOURCE);
    const after = parseMarkdown(SOURCE.replace("Last paragraph.", "Last paragraph, edited."));

    const changed = before.blocks.filter((block, index) => block.id !== after.blocks[index].id);
    expect(changed.map((block) => block.text)).toEqual(["Last paragraph."]);
  });
});

describe("heading ids", () => {
  test("are unique when a heading looks like the suffix of a repeated one", () => {
    const { headings, sections } = parseMarkdown("## Bar\n\n## Bar\n\n## Bar 2\n\n## Bar\n");
    const ids = headings.map((heading) => heading.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 2)).toEqual(["bar", "bar-2"]);
    expect(sections.map((section) => section.id)).toEqual(ids);
  });

  test("never take the id of the element the document is rendered in", () => {
    const { headings } = parseMarkdown("# Doc\n\nText.\n");

    expect(headings[0].id).not.toBe("doc");
  });
});

describe("sections", () => {
  test("lift a leading code from the heading", () => {
    const { sections } = parseMarkdown(SOURCE);
    const byText = Object.fromEntries(sections.map((section) => [section.text, section]));

    expect(byText["Part A. Overlay"]).toMatchObject({ code: "Part A", title: "Overlay", depth: 1 });
    expect(byText["A1. Product intent"]).toMatchObject({ code: "A1", title: "Product intent" });
    expect(byText["3.2 Numbers"]).toMatchObject({ code: "3.2", title: "Numbers" });
  });

  test("keep the whole heading as the title when there is no code", () => {
    const headings = [
      "Plain heading",
      "Step by step guide",
      "2024 roadmap",
      "Q3 results",
      "A1.",
      "Part of the plan",
    ];
    const { sections } = parseMarkdown(headings.map((heading) => `## ${heading}`).join("\n\n"));

    for (const section of sections) {
      expect(section.code, section.text).toBeUndefined();
      expect(section.title).toBe(section.text);
    }
  });

  test("put every block in exactly one section, in document order", () => {
    const { blocks, sections } = parseMarkdown(SOURCE);

    expect(sections.flatMap((section) => section.blockIds)).toEqual(
      blocks.map((block) => block.id),
    );
    for (const block of blocks) {
      const owner = sections.find((section) => section.blockIds.includes(block.id));
      expect(block.sectionId).toBe(owner?.id);
    }
  });

  test("give text above the first heading to the first section", () => {
    const { blocks, sections } = parseMarkdown("Preamble.\n\n## First\n\nBody.\n");

    expect(sections).toHaveLength(1);
    expect(blocks.map((block) => block.sectionId)).toEqual(["first", "first", "first"]);
  });

  test("survive a document without headings", () => {
    const { blocks, sections, stats } = parseMarkdown("Just a paragraph.\n\nAnd one more.\n");

    expect(sections).toEqual([]);
    expect(blocks.map((block) => block.sectionId)).toEqual(["", ""]);
    expect(stats.words).toBe(6);
    expect(stats.minutes).toBe(1);
  });

  test("change the hash of the edited section only", () => {
    const before = parseMarkdown(SOURCE);
    const after = parseMarkdown(SOURCE.replace("Last paragraph.", "Last paragraph, edited."));

    const changed = before.sections.filter(
      (section, index) => section.hash !== after.sections[index].hash,
    );
    expect(changed.map((section) => section.id)).toEqual(["plain-heading"]);
  });
});

describe("stats", () => {
  test("count a code term once, however often it appears", () => {
    const { stats } = parseMarkdown(SOURCE);

    // `a` is in a table cell and in a paragraph; `b` in a paragraph.
    expect(stats.codeTerms).toBe(2);
    expect(stats.tables).toBe(1);
    // The second-level headings: what a reader calls the sections.
    expect(stats.sections).toBe(3);
  });
});

describe("meta lines", () => {
  /** The meta parts of the first block of `source`. */
  const metaOf = (source: string) => metaParts(parseMarkdown(source).blocks[0].token);

  test("split short facts joined by middle dots", () => {
    expect(metaOf("TechFabric  ·  USA (remote)  ·  Sep 2019 – May 2023\n")).toEqual([
      { kind: "who", text: "TechFabric", ongoing: false },
      { kind: "place", text: "USA (remote)", ongoing: false },
      { kind: "when", text: "Sep 2019 – May 2023", ongoing: false },
    ]);
  });

  test("mark a span that runs until now", () => {
    const parts = metaOf("Checktur.io · Berlin · Oct 2024 – Present\n");

    expect(parts?.map((part) => part.ongoing)).toEqual([false, false, true]);
  });

  test("tell a span from a place when the line has no place", () => {
    const parts = metaOf("Paternity leave · Jun 2023 – Sep 2024\n");

    expect(parts?.map((part) => part.kind)).toEqual(["who", "when"]);
  });

  test("leave prose, markup and a lone fact a paragraph", () => {
    const prose =
      "The release slipped a week because the store review took longer than planned · again.";

    expect(metaOf(`${prose}\n`)).toBeUndefined();
    expect(metaOf("**Acme** · Berlin\n")).toBeUndefined();
    expect(metaOf("Acme · Berlin · [site](https://example.com)\n")).toBeUndefined();
    expect(metaOf("Acme·Berlin\n")).toBeUndefined();
    expect(metaOf("Just Berlin\n")).toBeUndefined();
  });
});

describe("skill rows", () => {
  /** The skill row of the first block of `source`. */
  const skillsOf = (source: string) => skillParts(parseMarkdown(source).blocks[0].token);

  test("split names by commas and lift what the brackets say", () => {
    expect(
      skillsOf("**CI/CD**\tXcode Cloud, Firebase (Analytics, Crashlytics), Node.js (Express)\n"),
    ).toEqual({
      label: "CI/CD",
      items: [
        { name: "Xcode Cloud" },
        { name: "Firebase", detail: "Analytics, Crashlytics" },
        { name: "Node.js", detail: "Express" },
      ],
    });
  });

  test("leave bold prose and a lone name a paragraph", () => {
    expect(skillsOf("**Note** the build, the tests and the release ran late.\n")).toBeUndefined();
    expect(skillsOf("**Mobile**\tReact Native\n")).toBeUndefined();
    expect(skillsOf("**Web**\tTypeScript, [Vite](https://vite.dev)\n")).toBeUndefined();
    expect(skillsOf("Mobile\tReact Native, Expo\n")).toBeUndefined();
  });
});

describe("contact lines", () => {
  /** The contact parts of the first block of `source`. */
  const contactOf = (source: string) => contactParts(parseMarkdown(source).blocks[0].token);

  test("tell the place, facts and ways to reach apart", () => {
    const line =
      "Berlin, Germany  ·  EU Blue Card  ·  [me@example.com](mailto:me@example.com)  ·  " +
      "+49 162 4303737  ·  [linkedin.com/in/me](https://linkedin.com/in/me/)  ·  " +
      "[github.com/me](https://github.com/me)  ·  [me.dev](https://me.dev)\n";

    expect(contactOf(line)).toEqual([
      { kind: "place", text: "Berlin, Germany" },
      { kind: "fact", text: "EU Blue Card" },
      { kind: "email", text: "me@example.com", href: "mailto:me@example.com" },
      { kind: "phone", text: "+49 162 4303737", href: "tel:+491624303737" },
      { kind: "linkedin", text: "linkedin.com/in/me", href: "https://linkedin.com/in/me/" },
      { kind: "github", text: "github.com/me", href: "https://github.com/me" },
      { kind: "web", text: "me.dev", href: "https://me.dev" },
    ]);
  });

  test("leave a meta line, prose and a link to this site alone", () => {
    expect(contactOf("Checktur.io · Berlin · Oct 2024 – Present\n")).toBeUndefined();
    expect(contactOf("Acme · 2019-2023\n")).toBeUndefined();
    expect(contactOf("Read the [notes](#a1) · Berlin\n")).toBeUndefined();
    expect(contactOf("Write to [me](mailto:me@example.com) any time\n")).toBeUndefined();
    expect(contactOf("**Acme** · [me@example.com](mailto:me@example.com)\n")).toBeUndefined();
  });
});
