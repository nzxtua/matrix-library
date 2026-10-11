/**
 * The documents of `src/content`: their file names, slugs and order, never
 * their text. The Enter page uses it to pick where `continue` goes without
 * loading `src/lib/content`.
 */

export interface ShelfEntry {
  /** As the glob gives it: `/src/content/02 Setup.md`. */
  path: string;
  /** `02 Setup.md`. */
  file: string;
  /** `02-setup`: the address of the document, `/content/02-setup`. */
  slug: string;
}

/** `02 Setup.md` -> `02-setup`. A name with no letter or digit left is `doc`. */
export function slugOf(file: string): string {
  const slug = file
    .replace(/\.md$/i, "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "doc";
}

/**
 * The documents in reading order: by file name, with numbers read as numbers
 * (`2-…` before `10-…`). Two names with the same slug get `-2`, `-3`.
 */
export function shelve(paths: readonly string[]): ShelfEntry[] {
  const files = paths.map((path) => ({ path, file: path.slice(path.lastIndexOf("/") + 1) }));
  files.sort((a, b) => a.file.localeCompare(b.file, "en", { numeric: true }));

  const taken = new Set<string>();
  return files.map(({ path, file }) => {
    const base = slugOf(file);
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    return { path, file, slug };
  });
}

/** Only the paths: each document is a chunk of its own that nothing here loads. */
const paths = Object.keys(import.meta.glob("/src/content/*.md", { query: "?raw" }));

/** Every document, in reading order. */
export const shelf: readonly ShelfEntry[] = shelve(paths);

/**
 * Where `continue` goes: the document the reader was in last, or the first one.
 * `undefined` when `src/content` has no document.
 */
export function entrySlug(last: string | null): string | undefined {
  return shelf.find((entry) => entry.slug === last)?.slug ?? shelf[0]?.slug;
}
