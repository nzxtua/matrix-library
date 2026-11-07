import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";

import { library } from "#/lib/content";
import type { Doc } from "#/lib/content";
import { copy } from "#/lib/copy";
import { progressOf, usePrefs } from "#/lib/prefs";

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      className="shelf-arrow"
      viewBox="0 0 20 20"
      aria-hidden="true"
      data-back={back || undefined}
    >
      <path d="M4 10h12m-4.5-4.5L16 10l-4.5 4.5" />
    </svg>
  );
}

/**
 * Above the title of a document: the way back to the
 * library, and where this document stands on the shelf.
 */
export function DocShelf({ doc }: { doc: Doc }) {
  const previous = library[doc.index - 1];
  const next = library[doc.index + 1];
  return (
    <nav className="doc-shelf" aria-label={copy.library.title}>
      <Link to="/content" className="doc-shelf__back">
        <Arrow back />
        {copy.library.back}
      </Link>
      <span className="doc-shelf__position">
        {copy.library.position(doc.index, library.length)}
      </span>
      <span className="doc-shelf__steps">
        {previous ? (
          <Link
            to="/content/$slug"
            params={{ slug: previous.slug }}
            className="doc-shelf__step"
            aria-label={`${copy.labels.previous}: ${previous.title}`}
            title={previous.title}
          >
            <Arrow back />
            {copy.labels.previous}
          </Link>
        ) : (
          <span className="doc-shelf__step" aria-hidden="true">
            <Arrow back />
            {copy.labels.previous}
          </span>
        )}
        {next ? (
          <Link
            to="/content/$slug"
            params={{ slug: next.slug }}
            className="doc-shelf__step"
            aria-label={`${copy.labels.next}: ${next.title}`}
            title={next.title}
          >
            {copy.labels.next}
            <Arrow />
          </Link>
        ) : (
          <span className="doc-shelf__step" aria-hidden="true">
            {copy.labels.next}
            <Arrow />
          </span>
        )}
      </span>
    </nav>
  );
}

/**
 * The end of the shelf: the way back to the library. One tube per document,
 * filled by its read share; the open one is ringed.
 */
function ShelfEnd({ doc }: { doc: Doc }) {
  const percents = usePrefs((prefs) => library.map((each) => progressOf(prefs, each.slug).percent));
  return (
    <Link to="/content" className="doc-next__card" data-end="">
      <span className="doc-next__eyebrow">
        {copy.library.end} · {copy.library.position(doc.index, library.length)}
      </span>
      <span className="doc-next__title">{copy.library.last}</span>
      <span className="doc-next__meta">{copy.library.backTo}</span>
      <span className="doc-next__tubes" aria-hidden="true">
        {library.map((each, index) => (
          <i
            key={each.slug}
            data-here={each.slug === doc.slug || undefined}
            style={{ "--read": (percents[index] ?? 0) / 100 } as CSSProperties}
          />
        ))}
      </span>
    </Link>
  );
}

/** Under the last block of a document: the next document, or the way back. */
export function DocNext({ doc }: { doc: Doc }) {
  const next = library[doc.index + 1];
  return (
    <nav className="doc-next" aria-label={next ? copy.library.next : copy.library.end}>
      {next ? (
        <Link to="/content/$slug" params={{ slug: next.slug }} className="doc-next__card">
          <span className="doc-next__eyebrow">
            {copy.library.next} · {copy.library.position(next.index, library.length)}
          </span>
          <span className="doc-next__title">{next.title}</span>
          <span className="doc-next__meta">{copy.stats.minutes(next.document.stats.minutes)}</span>
          <Arrow />
        </Link>
      ) : (
        <ShelfEnd doc={doc} />
      )}
    </nav>
  );
}
