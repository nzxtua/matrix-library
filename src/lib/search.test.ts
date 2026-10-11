import { describe, expect, test } from "vite-plus/test";

import { parseMarkdown } from "#/lib/markdown";
import { buildIndex, hasEveryWord, matchEntries, queryWords, search, snippet } from "#/lib/search";
import type { Snippet } from "#/lib/search";

const SOURCE = `# Field manual

Intro about the torch and the dark.

## A1. Torch care

Keep the torch dry. A wet battery is a dead battery.

| File | State | Notes |
| ---- | ----- | ----- |
| \`src/torch.ts\` | new | Holds the beam. |
| \`src/battery.ts\` | changed | Counts the charge of the torch battery. |

## A2. Spare battery

- Carry one spare.
- Check the battery charge before the night shift.

\`\`\`ts
const battery = charge(torch);
\`\`\`

## A3. The dark

Nothing to see. Battery, then silence, then the charge.
`;

const index = buildIndex(parseMarkdown(SOURCE));

/** The marked pieces of a snippet, as shown. */
function marked({ text, hits }: Snippet): string[] {
  return hits.map(([start, end]) => text.slice(start, end));
}

describe("matching", () => {
  test("an entry must hold every word of the query", () => {
    const hits = search(index, "wet battery").hits;
    expect(hits.map((hit) => hit.entry.text)).toEqual([
      "Keep the torch dry. A wet battery is a dead battery.",
    ]);
  });

  test("case and extra spaces in the query do not matter", () => {
    expect(search(index, "  WET   Battery ").total).toBe(1);
    expect(queryWords("  WET   Battery wet ")).toEqual(["wet", "battery"]);
  });

  test("a query without words finds nothing", () => {
    expect(search(index, "   ")).toMatchObject({ total: 0, hits: [], groups: [] });
    expect(matchEntries(index, "")).toEqual([]);
  });

  test("the rows of a table are found one by one, not as one table", () => {
    // "beam" is in the first row and "charge" in the second: no row has both.
    expect(search(index, "beam charge").total).toBe(0);

    const [hit] = search(index, "holds beam").hits;
    expect(hit.entry.kind).toBe("row");
    expect(hit.entry.lead).toBe("src/torch.ts");
    expect(hit.entry.rowId).toMatch(new RegExp(`^${hit.entry.blockId}-.+`));
  });

  test("a word in the key cell and a word in another cell of the row match together", () => {
    const hits = search(index, "battery.ts charge").hits;
    expect(hits).toHaveLength(1);
    expect(marked(hits[0].lead!)).toEqual(["battery.ts"]);
    expect(marked(hits[0].snippet)).toContain("charge");
  });

  test("the items of a list are found one by one", () => {
    const hits = search(index, "spare").hits.filter((hit) => hit.entry.kind === "item");
    expect(hits.map((hit) => [hit.entry.item, hit.entry.text])).toEqual([[0, "Carry one spare."]]);
  });

  test("twin rows of one table get different ids", () => {
    const twins = buildIndex(parseMarkdown("| a | b |\n| - | - |\n| x | y |\n| x | y |\n"));
    const ids = twins.entries.filter((entry) => entry.kind === "row").map((entry) => entry.rowId);
    expect(new Set(ids).size).toBe(2);
  });

  test("matchEntries gives every match in reading order", () => {
    const orders = matchEntries(index, "battery").map((entry) => entry.order);
    expect(orders.length).toBe(search(index, "battery", { limit: 1 }).total);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  test("hasEveryWord ignores case", () => {
    expect(hasEveryWord("Text Large", ["large", "text"])).toBe(true);
    expect(hasEveryWord("Text Large", ["small"])).toBe(false);
  });
});

describe("ranking", () => {
  test("a heading hit comes before a body hit that is earlier in the document", () => {
    const hits = search(index, "battery").hits;
    expect(hits[0].entry).toMatchObject({ kind: "heading", text: "A2. Spare battery" });
  });

  test("the whole phrase comes before the same words apart", () => {
    // The row holds "charge of the torch battery" (apart); the item holds "battery charge".
    const texts = search(index, "battery charge").hits.map((hit) => hit.entry.text);
    const phrase = texts.findIndex((text) => text.includes("battery charge"));
    const apart = texts.findIndex((text) => text.includes("charge of the torch battery"));
    expect(phrase).toBeGreaterThanOrEqual(0);
    expect(apart).toBeGreaterThan(phrase);
  });

  test("a word start comes before the same letters inside a word", () => {
    const local = buildIndex(parseMarkdown("The catalog is long.\n\nThe log is short.\n"));
    const texts = search(local, "log").hits.map((hit) => hit.entry.text);
    expect(texts).toEqual(["The log is short.", "The catalog is long."]);
  });

  test("the column names of a table come after a cell with the same words", () => {
    const local = buildIndex(
      parseMarkdown("| File | Merge guidance |\n| - | - |\n| a.ts | No merge guidance yet. |\n"),
    );
    const kinds = search(local, "merge guidance").hits.map((hit) => hit.entry.kind);
    expect(kinds).toEqual(["row", "table"]);
  });

  test("an entry knows the sub-heading it is under, until the next section", () => {
    const local = buildIndex(
      parseMarkdown("## One\n\n### Android\n\nmoth a\n\n## Two\n\nmoth b\n"),
    );
    expect(search(local, "moth").hits.map((hit) => hit.entry.under)).toEqual([
      "Android",
      undefined,
    ]);
  });

  test("equal hits keep the reading order", () => {
    const local = buildIndex(parseMarkdown("moth one\n\nmoth two\n\nmoth three\n"));
    expect(search(local, "moth").hits.map((hit) => hit.entry.text)).toEqual([
      "moth one",
      "moth two",
      "moth three",
    ]);
  });
});

describe("grouping", () => {
  test("hits are grouped by section and the section of the best hit is first", () => {
    const { groups, hits } = search(index, "battery");
    expect(groups[0].section?.id).toBe("a2-spare-battery");
    expect(groups.map((group) => group.section?.code)).toEqual(["A2", "A1", "A3"]);
    // The flat list is the groups one after another: the order on screen.
    expect(hits).toEqual(groups.flatMap((group) => group.hits));
  });

  test("the limit cuts the hits but not the count", () => {
    const all = search(index, "battery");
    const cut = search(index, "battery", { limit: 2 });
    expect(all.total).toBeGreaterThan(2);
    expect(cut.total).toBe(all.total);
    expect(cut.hits).toHaveLength(2);
    // The best hit survives the cut.
    expect(cut.hits[0].entry).toEqual(all.hits[0].entry);
    expect(search(index, "battery", { limit: 1 }).hits[0].entry.kind).toBe("heading");
  });

  test("a document without sections still gives one group", () => {
    const local = buildIndex(parseMarkdown("just a moth\n"));
    const { groups } = search(local, "moth");
    expect(groups).toHaveLength(1);
    expect(groups[0].section).toBeUndefined();
  });
});

describe("snippet", () => {
  const long = `${"dust ".repeat(60)}the Moth sat on the switch ${"dust ".repeat(60)}`.trim();

  test("a hit far inside a long text is shown, and the marks point at it", () => {
    const cut = snippet(long, ["moth", "switch"]);
    expect(cut.text.length).toBeLessThan(160);
    expect(cut.text.startsWith("…")).toBe(true);
    expect(cut.text.endsWith("…")).toBe(true);
    expect(marked(cut)).toEqual(["Moth", "switch"]);
  });

  test("a short text is shown whole", () => {
    const whole = snippet("the moth sat", ["moth"]);
    expect(whole.text).toBe("the moth sat");
    expect(marked(whole)).toEqual(["moth"]);
  });

  test("a long text without a hit shows its start", () => {
    const head = snippet(long, ["battery"]);
    expect(head.text.startsWith("dust dust")).toBe(true);
    expect(head.text.endsWith("…")).toBe(true);
    expect(head.hits).toEqual([]);
  });

  test("the window is cut at word ends", () => {
    const cut = snippet(long, ["moth"]);
    const inner = cut.text.replace(/^…|…$/g, "");
    for (const word of inner.split(" ")) {
      expect(["dust", "the", "Moth", "sat", "on", "switch"]).toContain(word);
    }
  });

  test("a hit at the end of a long text stays near the start of the snippet", () => {
    // Two lines on a phone hold about 80 characters: the mark must be in them.
    const cut = snippet(`${"dust ".repeat(60)}the moth.`, ["moth"]);
    expect(cut.text.endsWith("the moth.")).toBe(true);
    expect(cut.hits[0][0]).toBeLessThan(60);
  });

  test("the window holds as many of the words as it can", () => {
    const text = `moth ${"dust ".repeat(60)}the moth sat on the switch`;
    expect(marked(snippet(text, ["moth", "switch"]))).toEqual(["moth", "switch"]);
  });

  test("overlapping words give one mark", () => {
    expect(marked(snippet("the lights are out", ["light", "lights"]))).toEqual(["lights"]);
    expect(marked(snippet("aaaa", ["aa", "aaa"]))).toEqual(["aaaa"]);
  });

  test("every mark of every hit of a real search is a word of the query", () => {
    const { hits, words } = search(index, "the battery");
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      const pieces = [...marked(hit.snippet), ...(hit.lead ? marked(hit.lead) : [])];
      expect(pieces.length).toBeGreaterThan(0);
      for (const piece of pieces) expect(words).toContain(piece.toLowerCase());
    }
  });
});
