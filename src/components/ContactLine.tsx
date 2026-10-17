import { Fragment } from "react";
import type { ReactNode } from "react";

import { copy } from "#/lib/copy";
import { copyText } from "#/lib/jump";
import type { ContactKind, ContactPart } from "#/lib/markdown";

/** Line icons on a 16 grid, drawn with the stroke of the chip. */
const GLYPHS: Record<Exclude<ContactKind, "linkedin" | "github">, ReactNode> = {
  place: (
    <>
      <path d="M8 14.25s4.75-4.1 4.75-7.6a4.75 4.75 0 0 0-9.5 0c0 3.5 4.75 7.6 4.75 7.6Z" />
      <circle cx="8" cy="6.6" r="1.6" />
    </>
  ),
  fact: (
    <>
      <path d="M8 1.75 13 3.6v4.1c0 3.1-2.1 5.6-5 6.55-2.9-.95-5-3.45-5-6.55V3.6L8 1.75Z" />
      <path d="m5.75 7.9 1.6 1.6 2.9-3.1" />
    </>
  ),
  email: (
    <>
      <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="2" />
      <path d="m2.5 4.5 5.5 4.25 5.5-4.25" />
    </>
  ),
  phone: (
    <path d="M5.6 2.25H3.9a1.4 1.4 0 0 0-1.4 1.55 10.9 10.9 0 0 0 9.7 9.7 1.4 1.4 0 0 0 1.55-1.4v-1.7a1 1 0 0 0-.75-.97l-2.05-.55a1 1 0 0 0-1 .3l-.75.8a8.1 8.1 0 0 1-3.6-3.6l.8-.75a1 1 0 0 0 .3-1l-.55-2.05a1 1 0 0 0-.97-.75Z" />
  ),
  web: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M1.75 8h12.5M8 1.75c1.7 1.7 2.55 3.8 2.55 6.25S9.7 12.55 8 14.25C6.3 12.55 5.45 10.45 5.45 8S6.3 3.45 8 1.75Z" />
    </>
  ),
};

/** The real marks, in their own colours (`contact.css` sets them). */
const MARKS: Partial<Record<ContactKind, ReactNode>> = {
  linkedin: (
    <svg className="doc-contact__mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect width="24" height="24" rx="4.5" fill="#0A66C2" />
      <path
        fill="#fff"
        d="M7.1 9.6h-2.7V19h2.7V9.6Zm.2-2.9a1.55 1.55 0 1 0-3.1 0 1.55 1.55 0 0 0 3.1 0ZM19.6 13.4c0-2.55-1.35-4-3.45-4a3 3 0 0 0-2.7 1.5V9.6h-2.6V19h2.7v-4.9c0-1.3.6-2.2 1.75-2.2 1.1 0 1.6.8 1.6 2.2V19h2.7v-5.6Z"
      />
    </svg>
  ),
  github: (
    <svg className="doc-contact__mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.88.87 2.33.66.07-.52.28-.87.5-1.07-1.77-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z"
      />
    </svg>
  ),
};

function Icon({ kind }: { kind: ContactKind }) {
  const mark = MARKS[kind];
  return (
    <span className="doc-contact__well" aria-hidden="true">
      {mark ?? (
        <svg className="doc-contact__glyph" viewBox="0 0 16 16" focusable="false">
          {GLYPHS[kind as keyof typeof GLYPHS]}
        </svg>
      )}
    </span>
  );
}

/** What the copy button puts on the clipboard: the address, not the link. */
function copyValue(part: ContactPart): string | undefined {
  if (part.kind === "email") return part.href?.replace(/^mailto:/i, "");
  if (part.kind === "phone") return part.text;
  return undefined;
}

function Part({ part }: { part: ContactPart }) {
  const value = copyValue(part);
  const away = /^https?:/i.test(part.href ?? "");
  // "linkedin.com/in/me" for https://linkedin.com/in/me/: paper does not print it twice.
  const bare = part.href?.replace(/^https?:\/\/(?:www\.)?|\/$/gi, "");

  return (
    <span className="doc-contact__item" data-kind={part.kind}>
      {part.href ? (
        <a
          className="doc-contact__chip"
          href={part.href}
          target={away ? "_blank" : undefined}
          rel={away ? "noreferrer" : undefined}
          data-self={(away && bare === part.text.replace(/\/$/, "")) || undefined}
        >
          <Icon kind={part.kind} />
          <span className="doc-contact__value">{part.text}</span>
          {away && (
            <svg
              className="doc-contact__away"
              viewBox="0 0 12 12"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M3.5 8.5 8.5 3.5M4.5 3.5h4v4" />
            </svg>
          )}
        </a>
      ) : (
        <span className="doc-contact__chip">
          <Icon kind={part.kind} />
          <span className="doc-contact__value">{part.text}</span>
        </span>
      )}
      {value && (
        <button
          type="button"
          className="doc-contact__copy"
          aria-label={`${copy.labels.copyContact} ${part.text}`}
          title={copy.labels.copyContact}
          onClick={() => void copyText(value)}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
            <path d="M2.5 8H2a.5.5 0 0 1-.5-.5V2A.5.5 0 0 1 2 1.5h5.5A.5.5 0 0 1 8 2v.5" />
          </svg>
        </button>
      )}
    </span>
  );
}

/**
 * A contact line ("Berlin · email · phone · LinkedIn") as a row of chips: an
 * icon for what each part is, a link that does what the part says, and a copy
 * button for an address you type elsewhere. The middle dots stay in the text,
 * unseen: a copy of the line keeps its parts apart.
 */
export function ContactLine({ parts }: { parts: ContactPart[] }) {
  return (
    <address className="doc-contact">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="sr-only"> · </span>}
          <Part part={part} />
        </Fragment>
      ))}
    </address>
  );
}
