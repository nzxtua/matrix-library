/**
 * Search over the document. Pure: no DOM, nothing stored, no query kept.
 *
 * The index is built once from `document.blocks`. A block is one entry, but a
 * table gives one entry per row and a list one entry per item, so a result
 * points at the row or the item, not at a table of 29 rows.
 *
 * An entry matches when it contains every word of the query, in any case.
 * Ranking: heading hits first, then entries that hold the whole phrase, then
 * entries where every word starts a word, then reading order. The column
 * names of a table come after everything of the same rank: they are labels.
 */

import type { Tokens } from "marked";

import { blockText, plainText, rowIds } from "#/lib/markdown";
import type { MarkdownDocument, Section } from "#/lib/markdown";

export type EntryKind = "heading" | "text" | "item" | "row" | "table" | "code";

export interface SearchEntry {
  /** Position in the index. Entries are in reading order. */
  order: number;
  kind: EntryKind;
  /** The DOM id of the block wrapper the entry is in. */
  blockId: string;
  /** Id of the nav section. "" when the document has none. */
  sectionId: string;
  /** Kind "row": the DOM id of the `<tr>`, the same id `DocTable` gives it. */
  rowId?: string;
  /** Kind "item": the position of the item in its list, from 0. */
  item?: number;
  /** Kind "row": the short first cell, the key of the row. Searched too. */
  lead?: string;
  /** The nearest heading above the entry that is below the section level. Shown, not searched. */
  under?: string;
  /** What is searched and shown, on one line. */
  text: string;
}

export interface SearchIndex {
  entries: readonly SearchEntry[];
  sections: ReadonlyMap<string, Section>;
  /** `lead` and `text` of every entry, folded for matching. Same order as `entries`. */
  leads: readonly string[];
  texts: readonly string[];
}

/** A piece of text and the places of the query words in it. */
export interface Snippet {
  /** With "…" where the text was cut. */
  text: string;
  /** `[start, end)` in `text`. Sorted, never overlapping. */
  hits: Array<[start: number, end: number]>;
}

export interface SearchHit {
  entry: SearchEntry;
  /** The marked `entry.lead`, when the entry has one. */
  lead?: Snippet;
  snippet: Snippet;
}

export interface SearchGroup {
  /** `undefined` for a document without sections. */
  section?: Section;
  hits: SearchHit[];
}

export interface SearchResults {
  /** The words of the query, lower-cased, each once. */
  words: string[];
  /** How many entries match. `hits` may hold fewer: see `limit`. */
  total: number;
  /** The best hits, in the order they are shown: group after group. */
  hits: SearchHit[];
  /** `hits` by section. The section of the best hit is first. */
  groups: SearchGroup[];
}

/** A first cell longer than this is prose, not a key. */
const LEAD_MAX = 96;
/** Cells of a row are shown with this between them. */
const CELL_GAP = " · ";
const SNIPPET_WIDTH = 132;
/** Characters shown before the first hit of a snippet. */
const SNIPPET_CONTEXT = 28;
/** At the end of a text, at most this many characters are shown before the first hit. */
const SNIPPET_BACKFILL = 48;
const MAX_WORDS = 12;
const DEFAULT_LIMIT = 40;

const HEADING_SCORE = 4;
const PHRASE_SCORE = 2;
const WORD_START_SCORE = 1;
const TABLE_HEAD_PENALTY = 0.5;

/** One line: every run of white space is one space. */
function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Lower case, for matching. Lower-casing changes the length of a few
 * characters (İ); offsets would then be wrong for the original text, so such
 * a text is matched as written.
 */
function fold(text: string): string {
  const lower = text.toLowerCase();
  return lower.length === text.length ? lower : text;
}

/** Builds the index. Do it once per document. */
export function buildIndex(document: Pick<MarkdownDocument, "blocks" | "sections">): SearchIndex {
  const entries: SearchEntry[] = [];
  const leads: string[] = [];
  const texts: string[] = [];

  const add = (entry: Omit<SearchEntry, "order" | "text">, raw: string) => {
    const text = clean(raw);
    if (!text && !entry.lead) return;
    entries.push({ ...entry, order: entries.length, text });
    leads.push(fold(entry.lead ?? ""));
    texts.push(fold(text));
  };

  /** The last heading below the section level, until the next section starts. */
  let under: string | undefined;

  for (const block of document.blocks) {
    if (block.heading) {
      under = block.heading.depth > 2 ? clean(block.heading.text) : undefined;
      add({ blockId: block.id, sectionId: block.sectionId, kind: "heading" }, block.heading.text);
      continue;
    }

    const at = { blockId: block.id, sectionId: block.sectionId, under };

    if (block.kind === "table") {
      const table = block.token as Tokens.Table;
      const cellsOf = (row: Tokens.TableCell[]) => row.map((cell) => clean(plainText(cell.tokens)));

      add({ ...at, kind: "table" }, cellsOf(table.header).filter(Boolean).join(CELL_GAP));

      const ids = rowIds(block.id, table.rows);
      table.rows.forEach((row, index) => {
        const [first = "", ...rest] = cellsOf(row);
        const keyed = rest.length > 0 && first.length > 0 && first.length <= LEAD_MAX;
        add(
          { ...at, kind: "row", rowId: ids[index], lead: keyed ? first : undefined },
          (keyed ? rest : [first, ...rest]).filter(Boolean).join(CELL_GAP),
        );
      });
    } else if (block.kind === "list") {
      (block.token as Tokens.List).items.forEach((item, index) => {
        add({ ...at, kind: "item", item: index }, item.tokens.map(blockText).join(" "));
      });
    } else {
      add({ ...at, kind: block.kind === "code" ? "code" : "text" }, block.text);
    }
  }

  return {
    entries,
    leads,
    texts,
    sections: new Map(document.sections.map((section) => [section.id, section])),
  };
}

/** The words of a query: lower-cased, each once, in the order typed. */
export function queryWords(query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return [...new Set(words)].slice(0, MAX_WORDS);
}

/** `true` when `text` holds every word. For short lists that need no index, such as commands. */
export function hasEveryWord(text: string, words: readonly string[]): boolean {
  const hay = fold(text);
  return words.every((word) => hay.includes(word));
}

/** Not a score. A real score may be below zero: the column names with their penalty. */
const NO_MATCH = Number.NEGATIVE_INFINITY;

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** `word` appears in `hay` at the start of a word at least once. */
function startsWord(hay: string, word: string): boolean {
  for (let at = hay.indexOf(word); at !== -1; at = hay.indexOf(word, at + 1)) {
    if (at === 0 || !WORD_CHAR.test(hay[at - 1])) return true;
  }
  return false;
}

/** The score of entry `i`, or `NO_MATCH` when it does not hold every word. */
function scoreOf(index: SearchIndex, i: number, words: readonly string[], phrase: string): number {
  const lead = index.leads[i];
  const text = index.texts[i];
  for (const word of words) {
    if (!text.includes(word) && !lead.includes(word)) return NO_MATCH;
  }

  const { kind } = index.entries[i];
  let score = kind === "heading" ? HEADING_SCORE : kind === "table" ? -TABLE_HEAD_PENALTY : 0;
  if (text.includes(phrase) || lead.includes(phrase)) score += PHRASE_SCORE;
  if (words.every((word) => startsWord(text, word) || startsWord(lead, word))) {
    score += WORD_START_SCORE;
  }
  return score;
}

/** Every entry that holds every word of the query, in reading order. */
export function matchEntries(index: SearchIndex, query: string): SearchEntry[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const phrase = words.join(" ");
  return index.entries.filter((_, i) => scoreOf(index, i, words, phrase) !== NO_MATCH);
}

/**
 * The part of `text` around the query words, about `width` characters, cut at
 * word ends. Without a hit: the start of the text.
 */
export function snippet(text: string, words: readonly string[], width = SNIPPET_WIDTH): Snippet {
  const hay = fold(text);
  const found = words.filter((word) => word && hay.includes(word));

  let start = 0;
  let end = text.length;

  if (text.length > width) {
    // The window starts a little before an anchor: the phrase when it is
    // there, otherwise the first hit whose window holds the most words.
    let anchor = found.length > 1 ? hay.indexOf(found.join(" ")) : -1;
    if (anchor === -1 && found.length > 0) {
      let best = -1;
      for (const word of found) {
        const at = hay.indexOf(word);
        const from = Math.max(0, at - SNIPPET_CONTEXT);
        const held = found.filter((other) => {
          const where = hay.indexOf(other, from);
          return where !== -1 && where + other.length <= from + width;
        }).length;
        if (held > best || (held === best && at < anchor)) {
          best = held;
          anchor = at;
        }
      }
    }
    anchor = Math.max(0, anchor);

    start = Math.max(0, anchor - SNIPPET_CONTEXT);
    end = Math.min(text.length, start + width);
    // Near the end of the text the window fills up from the left, but only
    // so far: a narrow screen clamps the snippet to two lines and the hit
    // must stay inside them.
    if (end === text.length) {
      start = Math.max(0, Math.min(start, Math.max(end - width, anchor - SNIPPET_BACKFILL)));
    }

    // A cut in the middle of a word moves to the next word end, when there is one.
    if (start > 0 && text[start - 1] !== " ") {
      const space = text.indexOf(" ", start);
      if (space !== -1 && space < anchor) start = space + 1;
    }
    if (end < text.length && text[end] !== " ") {
      const space = text.lastIndexOf(" ", end);
      if (space > start + width / 2) end = space;
    }
  }

  const before = start > 0 ? "…" : "";
  const shown = text.slice(start, end);
  const body = end < text.length ? shown.trimEnd() : shown;
  const after = end < text.length ? "…" : "";
  const shift = before.length - start;
  const limit = start + body.length;

  const spans: Array<[number, number]> = [];
  for (const word of found) {
    for (let at = hay.indexOf(word, start); at !== -1; at = hay.indexOf(word, at + word.length)) {
      if (at + word.length > limit) break;
      spans.push([at + shift, at + word.length + shift]);
    }
  }
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // "light" and "lights" overlap: one mark, not two.
  const hits: Array<[number, number]> = [];
  for (const span of spans) {
    const last = hits.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else hits.push(span);
  }

  return { text: before + body + after, hits };
}

/**
 * The entries that hold every word of `query`, ranked, grouped by section.
 * At most `limit` hits get a snippet; `total` counts them all.
 */
export function search(
  index: SearchIndex,
  query: string,
  { limit = DEFAULT_LIMIT }: { limit?: number } = {},
): SearchResults {
  const words = queryWords(query);
  if (words.length === 0) return { words, total: 0, hits: [], groups: [] };

  const phrase = words.join(" ");
  const ranked: Array<{ i: number; score: number }> = [];
  for (let i = 0; i < index.entries.length; i++) {
    const score = scoreOf(index, i, words, phrase);
    if (score !== NO_MATCH) ranked.push({ i, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.i - b.i);

  const groups = new Map<string, SearchGroup>();
  for (const { i } of ranked.slice(0, Math.max(0, limit))) {
    const entry = index.entries[i];
    let group = groups.get(entry.sectionId);
    if (!group) {
      group = { section: index.sections.get(entry.sectionId), hits: [] };
      groups.set(entry.sectionId, group);
    }
    group.hits.push({
      entry,
      lead: entry.lead === undefined ? undefined : snippet(entry.lead, words, Infinity),
      snippet: snippet(entry.text, words),
    });
  }

  const list = [...groups.values()];
  return { words, total: ranked.length, hits: list.flatMap((group) => group.hits), groups: list };
}
