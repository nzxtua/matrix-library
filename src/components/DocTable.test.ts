import { marked } from "marked";
import type { Tokens } from "marked";
import { describe, expect, test } from "vite-plus/test";

import { filterRows, hasKeyColumn, toMarkdown, toTsv } from "#/components/DocTable";
import { rowIds } from "#/lib/markdown";

/** The first table in a Markdown source, as the page parses it. */
function table(source: string): Tokens.Table {
  const token = marked.lexer(source).find((item) => item.type === "table");
  if (!token) throw new Error("no table in the source");
  return token as Tokens.Table;
}

const texts = (rows: Tokens.TableCell[][]) => rows.map((row) => row.map((cell) => cell.text));

describe("rowIds", () => {
  const before = table("| a | b |\n| - | - |\n| one | 1 |\n| two | 2 |");
  const after = table("| a | b |\n| - | - |\n| zero | 0 |\n| one | 1 |\n| two | 2 |");

  test("a row keeps its id when a row is added above it", () => {
    const [one, two] = rowIds("t", before.rows);
    expect(rowIds("t", after.rows).slice(1)).toEqual([one, two]);
  });

  test("rows with the same text get different ids", () => {
    const twins = table("| a |\n| - |\n| same |\n| same |\n| same |");
    const ids = rowIds("t", twins.rows);
    expect(new Set(ids).size).toBe(3);
  });

  test("the same row in two tables gets two ids", () => {
    expect(rowIds("t1", before.rows)[0]).not.toBe(rowIds("t2", before.rows)[0]);
  });
});

describe("hasKeyColumn", () => {
  test("short names in the first column are keys", () => {
    const source =
      "| | what |\n| - | - |\n| Base | The commit the branch starts from, with a long story |\n| Size | Seven commits and a lot of words about them |";
    expect(hasKeyColumn(table(source))).toBe(true);
  });

  test("long file paths in code are keys", () => {
    const source =
      "| path | covers |\n| - | - |\n| `app/screens/Auth/IntegrationScreen.render.test.tsx` | the screen |\n| `app/hooks/view_models/usePreviousLogin.test.ts` (modified) | the hook |";
    expect(hasKeyColumn(table(source))).toBe(true);
  });

  test("a first column of prose is not a key column", () => {
    const source =
      "| claim | proof |\n| - | - |\n| The queue keeps a report until the network is back again | `queue.ts` |\n| Nothing leaves the device while the reader is offline | `net.ts` |\n| ok | `x` |";
    expect(hasKeyColumn(table(source))).toBe(false);
  });

  test("a table with one column has no key column", () => {
    expect(hasKeyColumn(table("| name |\n| - |\n| a |\n| b |"))).toBe(false);
  });
});

describe("filterRows", () => {
  const rows = table(
    "| id | decision | reason |\n| - | - | - |\n| Q1 | Keep the `Queue` | Android only |\n| Q2 | Drop the polyfill | No code needs it |\n| Q3 | Android first | The queue is there |",
  ).rows;

  test("an empty query keeps every row", () => {
    expect(filterRows(rows, "")).toEqual([true, true, true]);
    expect(filterRows(rows, "   ")).toEqual([true, true, true]);
  });

  test("a row stays when it holds every word, in any cell and any case", () => {
    expect(filterRows(rows, "QUEUE android")).toEqual([true, false, true]);
  });

  test("code in a cell is searched as text", () => {
    expect(filterRows(rows, "the queue")).toEqual([true, false, true]);
  });

  test("a word that is nowhere hides every row", () => {
    expect(filterRows(rows, "queue zebra")).toEqual([false, false, false]);
  });
});

describe("toMarkdown", () => {
  const source =
    "| key | left | right |\n| --- | :--- | ---: |\n| `a \\| b` | **bold** and [a link](https://example.com) | 1 |\n| two | plain | 2 |\n| three | x \\| y | 3 |";

  test("the copy parses back to the same table", () => {
    const original = table(source);
    const copied = table(toMarkdown(original));
    expect(texts(copied.rows)).toEqual(texts(original.rows));
    expect(texts([copied.header])).toEqual(texts([original.header]));
    expect(copied.align).toEqual(original.align);
  });

  test("only the rows that the filter kept are copied", () => {
    const original = table(source);
    const copied = table(toMarkdown(original, [false, true, false]));
    expect(texts(copied.rows)).toEqual([["two", "plain", "2"]]);
  });
});

describe("toTsv", () => {
  test("every line has one field per column, whatever the cells hold", () => {
    const original = table(
      "| a | b |\n| - | - |\n| one<br>two | `code` and **bold** |\n| x \\| y | [link](https://example.com) |",
    );
    // A cell that came with a tab or a line break in its text.
    original.rows[0][0].tokens = [
      { type: "text", raw: "one\ttwo\nthree", text: "one\ttwo\nthree" },
    ];

    const lines = toTsv(original).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.split("\t").length)).toEqual([2, 2, 2]);
    expect(lines[1]).toBe("one two three\tcode and bold");
    expect(lines[2]).toBe("x | y\tlink");
  });

  test("only the rows that the filter kept are copied", () => {
    const original = table("| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |");
    expect(toTsv(original, [false, true])).toBe("a\tb\n3\t4");
  });
});
