import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { Token, Tokens } from "marked";

import { copy } from "#/lib/copy";
import { copyText } from "#/lib/jump";
import { plainText } from "#/lib/markdown";
import type { FlipToken } from "#/lib/markdown";

/** Links that leave the site. A relative link has no target here. */
const EXTERNAL_LINK = /^(https?:|mailto:)/i;

/** A link label up to this many characters is kept on one line. */
const SHORT_LABEL = 18;

/** U+2060. A line never breaks next to it. */
const WORD_JOINER = String.fromCharCode(0x2060);

/**
 * A link whose target is not part of this site: a chip that copies its
 * address. A `<span>` and not a `<button>`, so that a long address wraps
 * with the line it is in.
 */
function RefChip({ href, text, children }: { href: string; text: string; children: ReactNode }) {
  const copyAddress = () => void copyText(href);

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    // Space would scroll the page.
    event.preventDefault();
    copyAddress();
  };

  return (
    <span
      className="doc-ref"
      role="button"
      tabIndex={0}
      title={`${copy.labels.address}: ${href}`}
      data-href={href}
      // The text is the address itself: paper does not print it twice.
      data-self={text === href || undefined}
      // A short label is one word to the eye: one chip, not two halves.
      data-short={text.length <= SHORT_LABEL || undefined}
      onClick={copyAddress}
      onKeyDown={onKeyDown}
    >
      {children}
      {/* The icon never starts a line alone: a word joiner holds it to the
          last word, and only inside a no-wrap span does the browser keep a
          joiner and an icon together. */}
      <span className="doc-ref__tail">
        {WORD_JOINER}
        <svg className="doc-ref__icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
          <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
          <path d="M2.5 8H2a.5.5 0 0 1-.5-.5V2A.5.5 0 0 1 2 1.5h5.5A.5.5 0 0 1 8 2v.5" />
        </svg>
      </span>
    </span>
  );
}

/**
 * A highlighted word that turns over on a click and shows the word on its
 * back. Only the face on show takes room, so the line closes up.
 */
function Flip({ front, back }: { front: ReactNode; back: string }) {
  const [flipped, setFlipped] = useState(false);

  return (
    <button
      type="button"
      className="doc-flip"
      data-flipped={flipped || undefined}
      aria-pressed={flipped}
      aria-label={flipped ? back : undefined}
      title={flipped ? undefined : back}
      onClick={() => setFlipped((on) => !on)}
    >
      <span className="doc-flip__card">
        <span className="doc-flip__face" aria-hidden={flipped || undefined}>
          {front}
        </span>
        <span className="doc-flip__face doc-flip__face--back" aria-hidden={!flipped || undefined}>
          {back}
        </span>
      </span>
    </button>
  );
}

/**
 * `echo`: a code term is a target for Echo. Inside a link it is not: a click
 * there belongs to the link.
 */
function render(tokens: Token[], echo: boolean): ReactNode {
  return tokens.map((token, key) => {
    switch (token.type) {
      case "strong":
        return <strong key={key}>{render((token as Tokens.Strong).tokens, echo)}</strong>;
      case "em":
        return <em key={key}>{render((token as Tokens.Em).tokens, echo)}</em>;
      case "del":
        return <del key={key}>{render((token as Tokens.Del).tokens, echo)}</del>;
      case "codespan":
        // One delegated listener on `#doc` finds a code term by `data-echo`.
        // It takes a click but is not a tab stop: a document has a thousand
        // of them. The keyboard reaches Echo with a hotkey.
        return (
          <code key={key} data-echo={echo ? "" : undefined}>
            {(token as Tokens.Codespan).text}
          </code>
        );
      case "br":
        return <br key={key} />;
      case "flip": {
        const flip = token as unknown as FlipToken;
        return <Flip key={key} front={render(flip.tokens, false)} back={flip.back} />;
      }
      case "link": {
        const link = token as Tokens.Link;
        return EXTERNAL_LINK.test(link.href) ? (
          <a key={key} href={link.href} target="_blank" rel="noreferrer">
            {render(link.tokens, false)}
          </a>
        ) : (
          <RefChip key={key} href={link.href} text={plainText(link.tokens)}>
            {render(link.tokens, false)}
          </RefChip>
        );
      }
      case "text": {
        const text = token as Tokens.Text;
        return text.tokens ? render(text.tokens, echo) : text.text;
      }
      case "image":
      case "escape":
        return (token as Tokens.Image | Tokens.Escape).text;
      default:
        return token.raw;
    }
  });
}

/** Renders inline Markdown tokens. Raw HTML is shown as written, never executed. */
export function renderInline(tokens: Token[]): ReactNode {
  return render(tokens, true);
}
