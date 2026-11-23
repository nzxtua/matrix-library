import { Marked } from "marked";
import type { Token, TokenizerExtension, Tokens } from "marked";

/**
 * A word with a second word on its back: `==Denys|Sukhobok==`. The text of
 * the token is the front, so a heading slug, search and a copy read "Denys".
 */
export interface FlipToken {
  type: "flip";
  raw: string;
  text: string;
  back: string;
  tokens: Token[];
}

const flip: TokenizerExtension = {
  name: "flip",
  level: "inline",
  start: (src) => src.indexOf("=="),
  tokenizer(src) {
    const match = /^==([^=|\n]+)\|([^=\n]+)==/.exec(src);
    if (!match) return undefined;
    return {
      type: "flip",
      raw: match[0],
      text: match[1],
      back: match[2],
      tokens: this.lexer.inlineTokens(match[1]),
    };
  },
};

const lexer = (source: string) => new Marked({ extensions: [flip] }).lexer(source);

import { fnv1a } from "#/lib/hash";

export interface Heading {
  id: string;
  depth: number;
  /** The heading without its Markdown markup. */
  text: string;
}

export interface Block {
  /** "b-" + fnv1a(token.raw), "-2" suffix on collision. The DOM id of the block wrapper. */
  id: string;
  /** `token.type`: "heading" | "paragraph" | "table" | "code" | "list" | ... */
  kind: string;
  token: Token;
  /** For heading blocks; `heading.id` is the slug on the `<hN>`. */
  heading?: Heading;
  /** Id of the nav section (depth <= 2 heading) this block is in. "" when the document has none. */
  sectionId: string;
  /** Plain text, for search and word counts. */
  text: string;
  words: number;
}

export interface Section {
  /** Heading slug. */
  id: string;
  depth: 1 | 2;
  /** Full heading text. */
  text: string;
  /** Leading code lifted by regex: "A1", "Part A", "3.2" ... */
  code?: string;
  /** `text` without the code. */
  title: string;
  words: number;
  /** At 220 words per minute, at least 1. */
  minutes: number;
  /** fnv1a of the raws of its blocks. */
  hash: string;
  blockIds: string[];
}

export interface MarkdownDocument {
  tokens: Token[];
  /** Every top-level heading in document order. */
  headings: Heading[];
  /** Every top-level token that shows on the page, in document order. */
  blocks: Block[];
  sections: Section[];
  stats: { words: number; minutes: number; sections: number; tables: number; codeTerms: number };
}

const WORDS_PER_MINUTE = 220;

/** Text of inline tokens without their markup. */
export function plainText(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if ("tokens" in token && token.tokens) return plainText(token.tokens);
      return "text" in token && typeof token.text === "string" ? token.text : token.raw;
    })
    .join("");
}

/** What a table row says, cell by cell. */
export function rowText(row: Tokens.TableCell[]): string {
  return row.map((cell) => plainText(cell.tokens)).join("\t");
}

/**
 * The DOM id of every row of a table block: `{id}-{fnv1a(row text)}`, so a
 * link to a row survives rows that are added or removed around it. A second
 * row with the same text gets "-2". `DocTable` renders these ids and search
 * jumps to them.
 */
export function rowIds(id: string, rows: Tokens.TableCell[][]): string[] {
  const used = new Map<string, number>();
  return rows.map((row) => {
    const base = `${id}-${fnv1a(rowText(row))}`;
    const seen = used.get(base) ?? 0;
    used.set(base, seen + 1);
    return seen ? `${base}-${seen + 1}` : base;
  });
}

/** Text of a block token: what a reader sees, cells and items on their own lines. */
export function blockText(token: Token): string {
  switch (token.type) {
    case "space":
    case "hr":
    case "def":
      return "";
    case "code":
      return (token as Tokens.Code).text;
    case "table": {
      const table = token as Tokens.Table;
      return [table.header, ...table.rows].map(rowText).join("\n");
    }
    case "list":
      return (token as Tokens.List).items
        .map((item) => item.tokens.map(blockText).filter(Boolean).join("\n"))
        .join("\n");
    case "blockquote":
      return (token as Tokens.Blockquote).tokens.map(blockText).filter(Boolean).join("\n");
    default:
      return "tokens" in token && token.tokens ? plainText(token.tokens) : token.raw.trim();
  }
}

function countWords(text: string): number {
  const words = text.match(/\S+/g);
  return words ? words.length : 0;
}

function minutesFor(words: number): number {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

/** Calls `visit` for every token inside `tokens`: in cells, items and quotes too. */
function walkTokens(tokens: Token[], visit: (token: Token) => void): void {
  for (const token of tokens) {
    visit(token);
    if (token.type === "table") {
      const table = token as Tokens.Table;
      for (const cell of table.header) walkTokens(cell.tokens, visit);
      for (const row of table.rows) {
        for (const cell of row) walkTokens(cell.tokens, visit);
      }
    } else if (token.type === "list") {
      for (const item of (token as Tokens.List).items) walkTokens(item.tokens, visit);
    } else if ("tokens" in token && token.tokens) {
      walkTokens(token.tokens, visit);
    }
  }
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "") || "section"
  );
}

/** "Part A. Title", "Chapter 3: Title", "Step 2 - Title". */
const NAMED_CODE =
  /^((?:part|chapter|section|appendix|phase|step|stage)\s+(\S+?))[.:)]?(?:\s+[-–—])?\s+(\S.*)$/i;
/** What may follow the word: "A", "12", "3.2", "IV". Never an ordinary word. */
const DESIGNATOR = /^(?:\d+(?:\.\d+)*|[A-Z]|[IVXLCDM]+)$/;
/** "A1. Title", "3) Title", "B-12: Title", "2.1 - Title". Punctuation is required. */
const SHORT_CODE =
  /^([A-Z]{1,3}[-.]?\d{1,3}(?:\.\d{1,3})*|\d{1,3}(?:\.\d{1,3})*)(?:[.:)]|\s+[-–—])\s+(\S.*)$/;
/** "3.2 Title": a dotted number needs no punctuation. */
const DOTTED_CODE = /^(\d{1,3}(?:\.\d{1,3})+)\s+(\S.*)$/;

/**
 * Splits a heading into a leading code and the rest. A heading without a
 * code, or one that is only a code, keeps its whole text as the title.
 */
export function liftCode(text: string): { code?: string; title: string } {
  const named = NAMED_CODE.exec(text);
  if (named && DESIGNATOR.test(named[2])) return { code: named[1], title: named[3] };

  const short = SHORT_CODE.exec(text) ?? DOTTED_CODE.exec(text);
  if (short) return { code: short[1], title: short[2] };

  return { title: text };
}

/** The joint of a meta line: a middle dot with space on both sides. */
const META_JOINT = /\s+·\s+/;
/** A part longer than this is prose, not a fact. */
const META_PART_MAX = 48;
/** A span that has not ended: "Oct 2024 – Present". */
const ONGOING = /[–—-]\s*(?:present|now|today)$/i;
/** A part that names a time: it holds a year ("Sep 2019 – May 2023"). */
const WHEN = /\b(?:19|20)\d{2}\b/;

/**
 * What a part of a meta line is: `who` opens the line ("TechFabric"), `when`
 * holds a year, `place` is any other part ("USA (remote)").
 */
export type MetaKind = "who" | "place" | "when";

export interface MetaPart {
  kind: MetaKind;
  text: string;
  /** A span that runs until now. */
  ongoing: boolean;
}

/**
 * The parts of a meta line: a paragraph of short plain facts joined by " · ",
 * as "TechFabric · USA (remote) · Sep 2019 – May 2023". `undefined` for any
 * other paragraph: one with markup, a single fact, or a long part (prose).
 */
export function metaParts(token: Token): MetaPart[] | undefined {
  if (token.type !== "paragraph") return undefined;
  const [only, ...more] = (token as Tokens.Paragraph).tokens;
  if (!only || more.length > 0 || only.type !== "text" || (only as Tokens.Text).tokens) {
    return undefined;
  }
  const parts = (only as Tokens.Text).text.trim().split(META_JOINT);
  if (parts.length < 2 || parts.some((part) => !part || part.length > META_PART_MAX)) {
    return undefined;
  }
  return parts.map((text, index) => ({
    kind: WHEN.test(text) ? "when" : index === 0 ? "who" : "place",
    text,
    ongoing: ONGOING.test(text),
  }));
}

/**
 * What a part of a contact line is. `place` is the plain fact that opens the
 * line ("Berlin, Germany"); `fact` is any other plain fact ("EU Blue Card").
 */
export type ContactKind = "place" | "fact" | "email" | "phone" | "linkedin" | "github" | "web";

export interface ContactPart {
  kind: ContactKind;
  /** What the reader sees. */
  text: string;
  /** Where the part leads: `mailto:`, `tel:` or a web address. */
  href?: string;
}

/** A link a contact line may hold: it leaves the site. */
const CONTACT_LINK = /^(?:https?:|mailto:|tel:)/i;
/** "+49 162 4303737", "(030) 123 4567", "0162 4303737". A year span starts with a digit 1–9. */
const PHONE = /^(?:\+|0|\()[\d\s().-]+$/;
/** A phone number has at least this many digits. */
const PHONE_DIGITS = 7;

function linkKind(href: string): ContactKind {
  if (/^mailto:/i.test(href)) return "email";
  if (/^tel:/i.test(href)) return "phone";
  const host = /^https?:\/\/(?:www\.)?([^/?#]+)/i.exec(href)?.[1]?.toLowerCase() ?? "";
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedin";
  if (host === "github.com") return "github";
  return "web";
}

function isPhone(text: string): boolean {
  return PHONE.test(text) && (text.match(/\d/g)?.length ?? 0) >= PHONE_DIGITS;
}

/**
 * The parts of a contact line: short facts and links joined by " · ", with at
 * least one way to reach someone (an email, a phone number, a web link), as
 * "Berlin · [me@example.com](mailto:me@example.com) · +49 30 1234567".
 * `undefined` for any other paragraph: one with other markup, a link to this
 * site, a long part, or nothing to reach.
 */
export function contactParts(token: Token): ContactPart[] | undefined {
  if (token.type !== "paragraph") return undefined;

  // Each segment is the text and links between two joints.
  const segments: Token[][] = [[]];
  for (const inline of (token as Tokens.Paragraph).tokens) {
    if (inline.type === "link") {
      segments[segments.length - 1].push(inline);
      continue;
    }
    if (inline.type !== "text" || (inline as Tokens.Text).tokens) return undefined;
    (inline as Tokens.Text).text.split(META_JOINT).forEach((piece, index) => {
      if (index > 0) segments.push([]);
      if (piece.trim()) segments[segments.length - 1].push({ ...inline, raw: piece, text: piece });
    });
  }

  const parts: ContactPart[] = [];
  for (const segment of segments) {
    if (segment.length !== 1) return undefined;
    const [only] = segment;
    if (only.type === "link") {
      const link = only as Tokens.Link;
      if (!CONTACT_LINK.test(link.href)) return undefined;
      parts.push({ kind: linkKind(link.href), text: plainText(link.tokens), href: link.href });
      continue;
    }
    const text = (only as Tokens.Text).text.trim();
    if (text.length > META_PART_MAX) return undefined;
    if (isPhone(text)) {
      parts.push({ kind: "phone", text, href: `tel:${text.replace(/[^\d+]/g, "")}` });
    } else {
      parts.push({ kind: parts.length === 0 ? "place" : "fact", text });
    }
  }

  const reachable = parts.some((part) => part.href);
  return parts.length >= 2 && reachable ? parts : undefined;
}

export interface SkillItem {
  /** "Firebase". */
  name: string;
  /** What the brackets after the name say: "Analytics, Crashlytics". */
  detail?: string;
}

export interface SkillRow {
  /** "Mobile". */
  label: string;
  items: SkillItem[];
}

/** A label longer than this is a sentence that starts in bold. */
const SKILL_LABEL_MAX = 32;

/** The parts of `text` between commas that stand outside brackets. */
function splitOutsideBrackets(text: string): string[] {
  const parts = [""];
  let depth = 0;
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) parts.push("");
    else parts[parts.length - 1] += char;
  }
  return parts.map((part) => part.trim());
}

/**
 * A skills row: a bold label, a tab, then short names joined by commas, as
 * "**Web**\tTypeScript, Node.js (Express), Vite". Brackets after a name are its
 * detail. `undefined` for any other paragraph: one without the tab, with other
 * markup, with a long part, or with fewer than two names.
 */
export function skillParts(token: Token): SkillRow | undefined {
  if (token.type !== "paragraph") return undefined;
  const [strong, list, ...more] = (token as Tokens.Paragraph).tokens;
  if (strong?.type !== "strong" || list?.type !== "text" || more.length > 0) return undefined;
  if ((list as Tokens.Text).tokens) return undefined;

  const label = plainText((strong as Tokens.Strong).tokens).trim();
  const { text } = list as Tokens.Text;
  if (!label || label.length > SKILL_LABEL_MAX || !/^ *\t/.test(text)) return undefined;

  const items: SkillItem[] = [];
  for (const part of splitOutsideBrackets(text)) {
    const match = /^([^()]+?)\s*(?:\(([^()]+)\))?$/.exec(part);
    if (!match || match[1].length > META_PART_MAX) return undefined;
    items.push(match[2] ? { name: match[1], detail: match[2].trim() } : { name: match[1] });
  }
  return items.length >= 2 ? { label, items } : undefined;
}

export function parseMarkdown(source: string): MarkdownDocument {
  const tokens = lexer(source);
  // "doc" is the id of the <main> the document is rendered in.
  const usedSlugs = new Set<string>(["doc"]);
  const usedIds = new Map<string, number>();

  const headings: Heading[] = [];
  const blocks: Block[] = [];
  const sections: Section[] = [];
  /** The blocks of every section, in the order of `sections`. */
  const sectionBlocks: Block[][] = [];
  /** Blocks above the first section heading. They join the first section. */
  const preamble: Block[] = [];

  // Headings are never nested in this walk: one inside a list or a quote is
  // not a section of the document.
  for (const token of tokens) {
    // A link definition is used by the lexer and shows nothing itself.
    if (token.type === "space" || token.type === "def") continue;

    // The id comes from the block's own text and nothing else, so it stays
    // the same when the text around the block changes. Blank lines around a
    // block are part of `raw`: they are trimmed for the same reason.
    const base = `b-${fnv1a(token.raw.trim())}`;
    const seen = usedIds.get(base) ?? 0;
    usedIds.set(base, seen + 1);

    const text = blockText(token);
    const block: Block = {
      id: seen ? `${base}-${seen + 1}` : base,
      kind: token.type,
      token,
      sectionId: "",
      text,
      words: countWords(text),
    };

    if (token.type === "heading") {
      const { depth, tokens: inline } = token as Tokens.Heading;
      const headingText = plainText(inline);
      // "Bar", "Bar", "Bar 2": the second "Bar" takes "bar-2", so the third
      // heading must move on to "bar-2-2". A counter per slug cannot see that.
      const slug = slugify(headingText);
      let id = slug;
      for (let n = 2; usedSlugs.has(id); n++) id = `${slug}-${n}`;
      usedSlugs.add(id);

      const heading = { id, depth, text: headingText };
      headings.push(heading);
      block.heading = heading;

      if (depth <= 2) {
        sections.push({
          id: heading.id,
          depth: depth as 1 | 2,
          text: headingText,
          ...liftCode(headingText),
          words: 0,
          minutes: 1,
          hash: "",
          blockIds: [],
        });
        sectionBlocks.push(sections.length === 1 ? preamble : []);
      }
    }

    blocks.push(block);
    if (sections.length === 0) preamble.push(block);
    else sectionBlocks[sections.length - 1].push(block);
  }

  sections.forEach((section, index) => {
    const own = sectionBlocks[index];
    for (const block of own) block.sectionId = section.id;
    section.blockIds = own.map((block) => block.id);
    section.words = own.reduce((sum, block) => sum + block.words, 0);
    section.minutes = minutesFor(section.words);
    section.hash = fnv1a(own.map((block) => block.token.raw.trim()).join("\n"));
  });

  const words = blocks.reduce((sum, block) => sum + block.words, 0);

  // Tables are counted wherever they are. A code term is counted once,
  // however often it appears.
  let tables = 0;
  const codeTerms = new Set<string>();
  walkTokens(tokens, (token) => {
    if (token.type === "table") tables += 1;
    else if (token.type === "codespan") codeTerms.add((token as Tokens.Codespan).text);
  });

  // "Sections" are what a reader would count: the chapters under the parts.
  // A document without second-level headings counts its first-level ones.
  const chapters = sections.filter((section) => section.depth === 2).length;

  return {
    tokens,
    headings,
    blocks,
    sections,
    stats: {
      words,
      minutes: minutesFor(words),
      sections: chapters || sections.length,
      tables,
      codeTerms: codeTerms.size,
    },
  };
}
