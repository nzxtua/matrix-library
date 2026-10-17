import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Tokens } from "marked";

import { copy } from "#/lib/copy";
import { copyText } from "#/lib/jump";

/** A block with more lines than this opens folded. */
const FOLD_OVER = 40;
/** A folded block shows this many lines. `doc.css` uses the same number. */
const FOLDED_LINES = 22;

/**
 * A fenced code block: a card with a bar (language, line count, fold, wrap,
 * copy). A long block opens folded. It unfolds by its button, and by itself
 * when something points into it: a jump that pings the block, or the
 * browser's own find that scrolls to a hidden line.
 */
export function CodeBlock({ token }: { token: Tokens.Code }) {
  const lines = token.text.split("\n").length;
  const foldable = lines > FOLD_OVER;
  // "ts title=x": the language is the first word.
  const lang = token.lang?.trim().split(/\s+/)[0];

  const [folded, setFolded] = useState(foldable);
  const [wrap, setWrap] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const preId = useId();

  // A jump to this block (search, hash, resume) pings its wrapper.
  useEffect(() => {
    if (!folded) return;
    const block = card.current?.closest(".doc__block");
    if (!block) return;
    const observer = new MutationObserver(() => {
      if (block.hasAttribute("data-ping")) setFolded(false);
    });
    observer.observe(block, { attributes: true, attributeFilter: ["data-ping"] });
    return () => observer.disconnect();
  }, [folded]);

  const fold = () => {
    // The reader is deep in the block. Go to its top first, so the fold
    // takes lines away below the reader and not the page from under them.
    // The wrapper of the block has the `scroll-margin-top` of every jump.
    const element = card.current;
    if (element && element.getBoundingClientRect().top < 0) {
      (element.closest(".doc__block") ?? element).scrollIntoView({
        block: "start",
        behavior: "instant",
      });
    }
    setFolded(true);
  };

  return (
    <div
      ref={card}
      className="codeblock"
      data-folded={folded || undefined}
      data-wrap={wrap || undefined}
      style={{ "--folded-lines": FOLDED_LINES } as CSSProperties}
    >
      <div className="codeblock__bar">
        <span className="codeblock__meta">
          {lang && <span className="codeblock__lang">{lang}</span>}
          <span>{copy.labels.lines(lines)}</span>
        </span>
        <span className="codeblock__tools">
          {foldable && !folded && (
            <button type="button" onClick={fold}>
              {copy.code.fold}
            </button>
          )}
          <button type="button" aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
            {copy.code.wrap}
          </button>
          <button type="button" onClick={() => void copyText(token.text)}>
            {copy.code.copy}
          </button>
        </span>
      </div>
      <pre
        id={preId}
        // A block that scrolls sideways must be reachable without a pointer.
        tabIndex={0}
        // Only something that looks for a hidden line scrolls a folded block.
        onScroll={(event) => {
          if (folded && event.currentTarget.scrollTop > 0) setFolded(false);
        }}
      >
        <code>{token.text}</code>
      </pre>
      {foldable && (
        <button
          type="button"
          className="codeblock__more"
          aria-expanded={!folded}
          aria-controls={preId}
          onClick={folded ? () => setFolded(false) : fold}
        >
          {folded ? copy.code.unfold(lines) : copy.code.fold}
        </button>
      )}
    </div>
  );
}
