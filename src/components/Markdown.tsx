import { Fragment, memo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Token, Tokens } from "marked";

import { CodeBlock } from "#/components/CodeBlock";
import { ContactLine } from "#/components/ContactLine";
import { DocHeader } from "#/components/DocHeader";
import { DocTable } from "#/components/DocTable";
import { renderInline } from "#/components/Inline";
import { SkillLine } from "#/components/SkillLine";
import { copy } from "#/lib/copy";
import { useDecodeOnView } from "#/lib/decode-on-view";
import { copyText, linkTo } from "#/lib/jump";
import { contactParts, metaParts, plainText, skillParts } from "#/lib/markdown";
import type { Block, MarkdownDocument, MetaKind, MetaPart, Section } from "#/lib/markdown";
import { useCurrentSection } from "#/lib/reading";

/** This many blocks from the top fall into place one after another. */
const REVEALED_BLOCKS = 16;

/**
 * Renders a token that is nested in a list or a quote. `path` makes the ids
 * of nested table rows unique inside the block.
 */
function renderNested(tokens: Token[], path: string): ReactNode {
  return tokens.map((token, key) => renderToken(token, `${path}-${key}`, key));
}

/** Line icons on a 16 grid for the parts of a meta line: target, pin, calendar. */
const META_GLYPHS: Record<MetaKind, ReactNode> = {
  who: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <circle cx="8" cy="8" r="3.5" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  place: (
    <>
      <path d="M8 14.25s4.75-4.1 4.75-7.6a4.75 4.75 0 0 0-9.5 0c0 3.5 4.75 7.6 4.75 7.6Z" />
      <circle cx="8" cy="6.6" r="1.6" />
    </>
  ),
  when: (
    <>
      <rect x="2" y="3" width="12" height="11" rx="2" />
      <path d="M2 6.75h12M5.25 1.75v2.5M10.75 1.75v2.5" />
    </>
  ),
};

/**
 * A meta line ("Company · Place · Dates") as a row of badges, each with the
 * icon of its kind: the first part in ink, a span that runs until now with a
 * live dot. The middle dots stay in the text, unseen: a copy of the line keeps
 * its parts apart.
 */
function MetaLine({ parts }: { parts: MetaPart[] }) {
  return (
    <p className="doc-meta">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="sr-only"> · </span>}
          <span
            className="doc-meta__badge"
            data-kind={part.kind}
            data-ongoing={part.ongoing || undefined}
          >
            <svg
              className="doc-meta__glyph"
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
            >
              {META_GLYPHS[part.kind]}
            </svg>
            {part.text}
          </span>
        </Fragment>
      ))}
    </p>
  );
}

function renderToken(token: Token, id: string, key?: number): ReactNode {
  switch (token.type) {
    case "space":
    case "def":
      return null;
    case "heading": {
      const { depth, tokens } = token as Tokens.Heading;
      const Tag = `h${depth}` as "h1";
      return <Tag key={key}>{renderInline(tokens)}</Tag>;
    }
    case "paragraph": {
      const contact = contactParts(token);
      if (contact) return <ContactLine key={key} parts={contact} />;
      const meta = metaParts(token);
      if (meta) return <MetaLine key={key} parts={meta} />;
      const skills = skillParts(token);
      if (skills) return <SkillLine key={key} row={skills} />;
      return <p key={key}>{renderInline((token as Tokens.Paragraph).tokens)}</p>;
    }
    case "text":
      // The text of a tight list item.
      return renderInline([token]);
    case "code":
      return <CodeBlock key={key} token={token as Tokens.Code} />;
    case "blockquote":
      return (
        <blockquote key={key}>{renderNested((token as Tokens.Blockquote).tokens, id)}</blockquote>
      );
    case "hr":
      return <hr key={key} />;
    case "checkbox":
      // It shows a state and takes no input.
      return (
        <input key={key} type="checkbox" checked={(token as Tokens.Checkbox).checked} disabled />
      );
    case "list": {
      const list = token as Tokens.List;
      const Tag = list.ordered ? "ol" : "ul";
      return (
        <Tag key={key} start={list.ordered && list.start !== "" ? list.start : undefined}>
          {list.items.map((item, index) => (
            <li key={index} data-task={item.task || undefined}>
              {renderNested(item.tokens, `${id}-${index}`)}
            </li>
          ))}
        </Tag>
      );
    }
    case "table":
      return <DocTable key={key} token={token as Tokens.Table} id={id} />;
    default:
      // Raw HTML and anything unknown is shown as written, never executed.
      return <p key={key}>{token.raw}</p>;
  }
}

/**
 * The inline tokens of a heading without its first `count` characters: the
 * code that is shown as a chip. `undefined` when markup stands in the way;
 * the heading then keeps its whole text.
 */
function dropLeading(tokens: Token[], count: number): Token[] | undefined {
  const [first, ...rest] = tokens;
  if (!first || first.type !== "text" || (first as Tokens.Text).tokens) return undefined;
  const { text } = first as Tokens.Text;
  if (text.length < count) return undefined;
  const kept = text.slice(count);
  return kept ? [{ ...first, raw: kept, text: kept } as Tokens.Text, ...rest] : rest;
}

/** The code of a heading and the inline tokens of the rest. Exported for its test. */
export function splitHeading(block: Block, section: Section | undefined) {
  const { tokens } = block.token as Tokens.Heading;
  if (!section?.code || !block.heading) return { tokens };
  const rest = dropLeading(tokens, block.heading.text.length - section.title.length);
  return rest?.length ? { code: section.code, tokens: rest } : { tokens };
}

/**
 * The chip of a section. It is lit while the reader is in that section, so
 * the heading that crosses the reading line takes the light.
 */
function SectionChip({ id, code }: { id: string; code: string }) {
  const lit = useCurrentSection() === id;
  return (
    <span className="doc-chip" data-code={code} data-lit={lit || undefined}>
      {code}
    </span>
  );
}

/** Copies the link to a heading. It sits in the gutter, next to the heading. */
function Anchor({ id }: { id: string }) {
  return (
    <button
      type="button"
      className="doc-anchor"
      aria-label={copy.labels.sectionLink}
      title={copy.labels.sectionLink}
      onClick={() => void copyText(linkTo(id), copy.linkCopied)}
    >
      <span aria-hidden="true">#</span>
    </button>
  );
}

/**
 * A part heading: a mono eyebrow, then the title. It waits as noise and
 * decodes when it scrolls into view. Its `aria-label` holds the real words,
 * so a screen reader never reads the noise.
 */
function PartHeading({ id, eyebrow, tokens }: { id: string; eyebrow: string; tokens: Token[] }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useDecodeOnView(ref);
  return (
    <h1 ref={ref} id={id} className="doc-part" aria-label={`${eyebrow} ${plainText(tokens)}`}>
      <span className="doc-part__eyebrow">{eyebrow}</span>{" "}
      <span className="doc-part__title">{renderInline(tokens)}</span>
    </h1>
  );
}

/**
 * A top-level heading. It keeps its slug as the id on the `<hN>`, and its
 * `::after` stays free for the ping.
 *
 * - h1 (a part): a mono eyebrow with the lifted code ("Part A") or the
 *   ordinal of the part ("01"), then the title.
 * - h2 (a section): a chip with the lifted code, then the title.
 * - h3 and deeper: the text as written.
 */
function renderHeading(block: Block, section: Section | undefined, ordinal: number): ReactNode {
  const heading = block.heading!;
  const { code, tokens } = splitHeading(block, section);
  // A space between the parts keeps the words apart for a screen reader and
  // for a copy of the selection. The layout ignores it.
  if (heading.depth === 1) {
    return (
      <>
        <PartHeading
          id={heading.id}
          eyebrow={code ?? String(ordinal).padStart(2, "0")}
          tokens={tokens}
        />
        <Anchor id={heading.id} />
      </>
    );
  }

  if (heading.depth === 2) {
    return (
      <>
        <h2 id={heading.id}>
          {code && <SectionChip id={heading.id} code={code} />}
          {code && " "}
          <span className="doc-h__title">{renderInline(tokens)}</span>
        </h2>
        <Anchor id={heading.id} />
      </>
    );
  }

  const Tag = `h${heading.depth}` as "h3";
  return (
    <>
      <Tag id={heading.id}>{renderInline((block.token as Tokens.Heading).tokens)}</Tag>
      <Anchor id={heading.id} />
    </>
  );
}

/**
 * The blocks of the document, each in its wrapper:
 *
 *   <div class="doc__block" id="{block.id}" data-kind="{block.kind}" data-section="{block.sectionId}">
 *
 * A heading block also has `data-depth`; the title block has `data-title`.
 * The parent renders `<main class="doc" id="doc">` around them. Memoized: the
 * document never changes, so nothing here renders twice. The parts that do
 * change (a section chip, a code block) are small components of their own.
 */
export const Markdown = memo(function Markdown({ document }: { document: MarkdownDocument }) {
  // The first heading is the page title, when it is a first-level one.
  const [first] = document.headings;
  const title = first?.depth === 1 ? first : undefined;
  const sections = new Map(document.sections.map((section) => [section.id, section]));
  /** Parts are counted for the ones that carry no code of their own. */
  let parts = 0;

  return document.blocks.map((block, order) => {
    const { heading } = block;
    const isTitle = heading !== undefined && heading === title;
    if (heading?.depth === 1 && !isTitle) parts += 1;

    return (
      <div
        key={block.id}
        className="doc__block"
        id={block.id}
        data-kind={block.kind}
        data-section={block.sectionId}
        data-depth={heading?.depth}
        data-title={isTitle || undefined}
        data-reveal={order < REVEALED_BLOCKS || undefined}
        style={order < REVEALED_BLOCKS ? ({ "--i": order } as CSSProperties) : undefined}
      >
        {isTitle ? (
          <DocHeader block={block} document={document} />
        ) : heading ? (
          renderHeading(block, sections.get(heading.id), parts)
        ) : (
          renderToken(block.token, block.id)
        )}
      </div>
    );
  });
});
