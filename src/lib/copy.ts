/**
 * Every string a reader sees. Dry, lowercase, about light.
 *
 * The test for a new string: would an engineer write it at 2 am, or a
 * marketer? No slang, no emoji, no exclamation marks.
 *
 * This module must stay free of content imports: the Enter page uses it.
 */

/** "1 table", "25 tables". */
function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const copy = {
  /** The two words in the dark behind the Enter button. */

  enter: {
    label: "ENTER",
    nag: "WELL?",
    hintPointer: "move the light",
    hintTouch: "touch and drag",
    hintKeys: "arrows aim · enter opens · 1–4 change the light",
    /** In order: the light floods, the document loads, the document is ready. */
    loading: ["finding the switch", "warming the tubes", "lights on"],
    skip: "click again to skip",
    /** Nothing read yet (a place, but 0 %): no number to show. */
    continue: (percent: number) =>
      Math.round(percent) > 0 ? `continue · ${Math.round(percent)}%` : "continue",
    found: (n: number) => `${n}/3`,
    foundAll: "3/3 · cryo unlocked",
    /** The three things in the dark: their names and the tags shown once found. */
    objects: { moth: "moth", switch: "light switch", battery: "spare battery" },
  },

  vibes: {
    ultraviolet: { label: "ultraviolet", note: "blacklight. the default." },
    phosphor: { label: "phosphor", note: "the old green." },
    sodium: { label: "sodium", note: "streetlight at 2am." },
    cryo: { label: "cryo", note: "cold light. found, not given." },
  },

  resume: {
    text: (section: string) => `you left the light on in ${section}.`,
    go: "pick up",
    reset: "start over",
    /** The place, when the document has no sections. */
    nowhere: "the dark",
  },

  read: {
    done: "every room is lit.",
  },

  /** The page of every document, and the way between documents. */
  library: {
    title: "content",
    /** The tab title of the library page. */
    pageTitle: "Site content",
    eyebrow: (docs: number, minutes: number) => `${count(docs, "document")} · ≈ ${minutes} min`,
    /** Not one block read yet. */
    unlit: "unlit",
    lit: (percent: number) => `${Math.round(percent)}% lit`,
    done: "every room lit",
    /** The document the reader was in last: `continue` opens it. */
    here: "you were here",
    empty: "the shelf is dark. put a .md file in src/content.",
    back: "library",
    /** "02 / 05". */
    position: (index: number, total: number) =>
      `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`,
    next: "next document",
    /** The last document: the end card. */
    end: "end of the shelf",
    last: "that was the last one.",
    backTo: "back to the library",
    /** The search group of the other documents. */
    elsewhere: "other documents",
  },

  search: {
    placeholder: "search the dark",
    empty: "nothing out there. try fewer letters.",
    hint: "↑↓ peek · ↵ go · ⇧↵ searchlight · esc back",
  },

  searchlight: {
    bar: (n: number) => `${n} lit · n / N step · esc lights on`,
  },

  curtain: {
    text: "lights out. any key to come back.",
    /** The tab title while the lights are out. */
    title: "…",
  },

  /** Reading by torchlight: the page goes dark, a beam follows the pointer. */
  torch: {
    on: "torch on. f to put it away.",
    /** No keyboard: the torch button puts it away. */
    onTouch: "torch on. tap the torch to put it away.",
  },

  /** The tab title while the reader is in another tab. */
  away: "the light's still on.",

  /** Easter eggs. Found, not announced. */
  eggs: {
    /** Too many clicks in the dark: the flashlight gives out. */
    batteryDead: "battery's dead.",
    /** …unless the spare battery was found. */
    batterySwapped: "swapped the battery.",
    batteryBack: "and we're back.",
    /** The Enter page hint between midnight and 5 am, local time. */
    night: "late shift. the light's on.",
    /** The Enter page, once every room of the document is lit. */
    allRead: "you've been everywhere. the ink remembers.",
    /** The devtools console. Never document text. */
    console: {
      greeting: "you found the wiring.",
      usage: 'lights.off() · lights.on() · lights.vibe("sodium")',
      off: "lights out.",
      on: "lights on.",
      noCurtain: "it's already dark in here.",
      unknownVibe: (names: string) => `no such light. try: ${names}.`,
      locked: "that one is locked. find three things in the dark.",
      vibe: (name: string) => `${name}.`,
    },
  },

  copied: "copied.",
  linkCopied: "link copied.",
  copyFailed: "clipboard said no.",

  echo: {
    count: (places: number, sections: number) =>
      `${count(places, "place")} · ${count(sections, "section")}`,
  },

  changed: "changed since you were here",

  table: {
    filter: (rows: number) => `filter ${count(rows, "row")}`,
    empty: "no rows. the filter is too picky.",
    /** The row count of a table too small to filter. */
    count: (rows: number) => count(rows, "row"),
    clear: "clear the filter",
    scroll: "table. scrolls sideways.",
  },

  code: {
    copy: "copy",
    wrap: "wrap",
    unfold: (lines: number) => `show all ${count(lines, "line")}`,
    fold: "fold",
  },

  comfort: {
    light: "light",
    text: "text",
    motion: "motion",
    clear: "clear my data on this device",
    cleared: "cleared. it's like you were never here.",
    locked: "find three things in the dark.",
    /** The confirm step of `clear`. */
    clearAsk: "all of it?",
    clearYes: "clear",
    clearNo: "keep",
  },

  keys: {
    title: "keys",
  },

  stats: {
    minutes: (n: number) => `≈ ${n} min`,
    sections: (n: number) => count(n, "section"),
    tables: (n: number) => count(n, "table"),
    codeTerms: (n: number) => count(n, "code term"),
  },

  minutes: (n: number) => `${n} min`,

  /**
   * Names of controls: button text, `aria-label`s, tooltips, command names.
   * Section 8 of the spec does not list them; they follow the same voice.
   */
  labels: {
    home: "back to the dark",
    sections: "sections",
    progress: (percent: number) => `${Math.round(percent)}% lit`,
    search: "search",
    ruler: "ruler",
    lightsOut: "lights out",
    keys: "keys",
    menu: "sections and settings",
    close: "close",
    previous: "previous",
    next: "next",
    sectionLink: "copy the link to this section",
    rowLink: "copy the link to this row",
    asMarkdown: "as markdown",
    asTsv: "as tsv",
    lines: (n: number) => count(n, "line"),
    rows: (shown: number, all: number) => `${shown} of ${all}`,
    sizes: { s: "small", m: "medium", l: "large" },
    motions: { full: "full", calm: "calm" },
    locked: "locked",
    hotkeyGroups: { find: "find", light: "light", read: "read", page: "page" },
    commands: "commands",
    tools: "tools",
    map: "map of the document",
    address: "copy the address",
    copyContact: "copy",
    aim: "aim the light",
    searchlight: "searchlight",
    litNext: "next lit place",
    litPrevious: "previous lit place",
    echo: "echo",
    echoKey: "echo a code term",
    echoClear: "clear the echo",
    rulerNext: "ruler to the next block",
    rulerPrevious: "ruler to the previous block",
    rulerOff: "put the ruler away",
    torch: "torch",
    torchBigger: "a wider beam",
    torchSmaller: "a narrower beam",
    sectionNext: "next section",
    sectionPrevious: "previous section",
    top: "back to the top",
    copySection: "copy this section as markdown",
    sectionCopied: "section copied.",
  },
} as const;
