import logoUrl from "#/content/logo.png";
import { parseMarkdown } from "#/lib/markdown";
import type { MarkdownDocument } from "#/lib/markdown";
import { shelve } from "#/lib/shelf";

/** The site shows every `src/content/*.md`, and `logo.png`. */
const sources = import.meta.glob<string>("/src/content/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

export interface Doc {
  slug: string;
  file: string;
  /** The first heading, or the file name. */
  title: string;
  document: MarkdownDocument;
  /** Place in the library, from 0. */
  index: number;
}

/** Every document, in reading order (`shelve`). */
export const library: readonly Doc[] = shelve(Object.keys(sources)).map(
  ({ path, file, slug }, index) => {
    const document = parseMarkdown(sources[path]);
    return { slug, file, title: document.headings[0]?.text ?? file, document, index };
  },
);

export function docBySlug(slug: string): Doc | undefined {
  return library.find((doc) => doc.slug === slug);
}

/** The document that has an element with this id: an old `/content#id` address. */
export function docWithId(id: string): Doc | undefined {
  return library.find(({ document }) =>
    document.blocks.some((block) => block.id === id || block.heading?.id === id),
  );
}

export { logoUrl };
