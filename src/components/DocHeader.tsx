import type { Tokens } from "marked";

import { renderInline } from "#/components/Inline";
import { copy } from "#/lib/copy";
import type { Block, MarkdownDocument } from "#/lib/markdown";

/** "≈ 40 min" with the number set apart, so the chip reads number first. */
function Stat({ text }: { text: string }) {
  const parts = text.split(/(\d[\d.,]*)/);
  return <li>{parts.map((part, key) => (key % 2 ? <b key={key}>{part}</b> : part))}</li>;
}

/**
 * The title block: the poster title and what the document holds, as a row of
 * chips. A count of zero is not shown.
 */
export function DocHeader({ block, document }: { block: Block; document: MarkdownDocument }) {
  const { stats } = document;
  const chips = [
    copy.stats.minutes(stats.minutes),
    stats.sections > 0 && copy.stats.sections(stats.sections),
    stats.tables > 0 && copy.stats.tables(stats.tables),
    stats.codeTerms > 0 && copy.stats.codeTerms(stats.codeTerms),
  ].filter((chip) => chip !== false);

  return (
    <header className="doc-header">
      <h1 id={block.heading?.id} className="doc-header__title">
        {renderInline((block.token as Tokens.Heading).tokens)}
      </h1>
      <ul className="doc-stats">
        {chips.map((text) => (
          <Stat key={text} text={text} />
        ))}
      </ul>
    </header>
  );
}
