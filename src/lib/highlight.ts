/**
 * Marks text without touching the DOM: the CSS Custom Highlight API.
 * `::highlight(search)` and `::highlight(echo)` are styled in
 * `styles/tokens.css`, `::highlight(filter)` in `styles/table.css`. Where the
 * API is missing, painting does nothing.
 */

export type HighlightName = "search" | "echo" | "filter";

export const supportsHighlight: boolean =
  typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

export interface RangeOptions {
  /** Only text inside an element that matches this selector, e.g. "code". */
  within?: string;
  /**
   * The needle must be the whole text of its text node (surrounding spaces
   * aside), in the same case. Without it: any occurrence, in any case.
   */
  exact?: boolean;
}

/**
 * Every place in `root` where `needle` appears, in document order.
 *
 * A match lies inside one text node: text that is split by markup ("a **b**")
 * is found word by word, not as a phrase.
 */
export function rangesOf(root: Element, needle: string, options: RangeOptions = {}): Range[] {
  const ranges: Range[] = [];
  if (typeof document === "undefined" || needle.trim() === "") return ranges;

  const { within, exact = false } = options;
  const wanted = exact ? needle.trim() : needle.toLowerCase();
  for (const scope of scopesOf(root, within)) collect(scope, wanted, exact, ranges);
  return ranges;
}

/**
 * Where to look: `root`, or with `within` the outermost matching elements in
 * it. Walking only those is far cheaper than testing every text node of a
 * long document.
 */
function scopesOf(root: Element, within: string | undefined): Element[] {
  if (!within || root.matches(within)) return [root];
  const scopes: Element[] = [];
  for (const element of root.querySelectorAll(within)) {
    // Document order: an ancestor comes before what it holds.
    const last = scopes.at(-1);
    if (!last || !last.contains(element)) scopes.push(element);
  }
  return scopes;
}

function collect(scope: Element, wanted: string, exact: boolean, ranges: Range[]): void {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? "";
    if (text.length < wanted.length) continue;

    if (exact) {
      if (text.trim() !== wanted) continue;
      const start = text.indexOf(wanted);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + wanted.length);
      ranges.push(range);
      continue;
    }

    const haystack = text.toLowerCase();
    // Lower-casing can change the length of a few characters (İ). Offsets are
    // then wrong for the original text, so such a node is searched as written.
    const source = haystack.length === text.length ? haystack : text;
    for (
      let at = source.indexOf(wanted);
      at !== -1;
      at = source.indexOf(wanted, at + wanted.length)
    ) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + wanted.length);
      ranges.push(range);
    }
  }
}

/** The ranges of every highlight, by owner: the registry holds one highlight per name. */
const owned = new Map<HighlightName, Map<string, Range[]>>();

/**
 * Shows `ranges` as the named highlight. An empty list clears them. Several
 * owners (one per table) can share a name: the union of their ranges is shown.
 */
export function paintHighlight(name: HighlightName, ranges: Range[], owner: string = name): void {
  if (!supportsHighlight) return;
  let owners = owned.get(name);
  if (!owners) owned.set(name, (owners = new Map()));
  if (ranges.length > 0) owners.set(owner, ranges);
  else if (!owners.delete(owner)) return;

  const all = [...owners.values()].flat();
  if (all.length === 0) CSS.highlights.delete(name);
  else CSS.highlights.set(name, new Highlight(...all));
}

export function clearHighlight(name: HighlightName): void {
  if (!supportsHighlight) return;
  owned.delete(name);
  CSS.highlights.delete(name);
}
