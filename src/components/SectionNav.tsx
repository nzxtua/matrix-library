import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";

import { copy } from "#/lib/copy";
import { jumpTo } from "#/lib/jump";
import type { MarkdownDocument, Section } from "#/lib/markdown";
import { useChangedSections, useCurrentSection, useReadShare } from "#/lib/reading";

/** Space kept between the current row and the edge of the list, in CSS pixels. */
const EDGE = 44;

/** The column of the code chips is never wider than this many characters. */
const MAX_CODE_LENGTH = 8;

/** One row of the navigation. */
export interface OutlineRow {
  section: Section;
  /**
   * - `title`: the heading that names the whole document.
   * - `part`: a heading above a group of sections. An eyebrow, like `title`.
   * - `section`: a row with a chip, a title, minutes and a ring.
   */
  kind: "title" | "part" | "section";
  /**
   * What stands before the title: the code lifted from the heading
   * (`A1`, `Part A`, `3.2`), or the ordinal of a part that has none (`01`).
   */
  code?: string;
  /** The row has text of its own, so a reading time and a read ring mean something. */
  meta: boolean;
}

export interface Outline {
  rows: OutlineRow[];
  /** Length of the longest chip, in characters. 0: no section has a code. */
  codeLength: number;
}

/**
 * The rows of the navigation for any document. Nothing here depends on the
 * words of the headings: only on their depth and on what `liftCode` found.
 */
export function outlineOf(document: MarkdownDocument): Outline {
  const { sections, headings } = document;
  const first = sections[0];
  const titleId = first && first.depth === 1 && headings[0]?.id === first.id ? first.id : undefined;
  // Without sections under them, the top headings are the rows themselves.
  const grouped = sections.some((section) => section.depth === 2);

  let parts = 0;
  let codeLength = 0;
  const rows = sections.map((section): OutlineRow => {
    // A heading alone is a label: there is nothing to read under it.
    const meta = section.blockIds.length > 1;

    if (section.id === titleId) return { section, kind: "title", meta };

    if (section.depth === 1 && grouped) {
      parts += 1;
      return {
        section,
        kind: "part",
        code: section.code ?? String(parts).padStart(2, "0"),
        meta,
      };
    }

    if (section.code) codeLength = Math.max(codeLength, section.code.length);
    return { section, kind: "section", code: section.code, meta: true };
  });

  return { rows, codeLength: Math.min(codeLength, MAX_CODE_LENGTH) };
}

/** The address already points at this section. */
function isAt(id: string): boolean {
  try {
    return decodeURIComponent(window.location.hash.slice(1)) === id;
  } catch {
    // A hash that is not valid percent-encoding is no section.
    return false;
  }
}

/** The closest box around `element` that scrolls up and down. Never the page. */
function scrollerOf(element: Element): HTMLElement | null {
  const page = element.ownerDocument;
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (node === page.body || node === page.documentElement) return null;
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}

/**
 * Brings the row into its list. Only the list scrolls, never the page.
 * `centre` puts the row in the middle; otherwise it moves the least it can.
 */
function keepInView(row: Element, centre: boolean) {
  const item = row.getBoundingClientRect();
  // A row without a box is not on screen (a closed sheet, a hidden panel).
  if (item.height === 0) return;
  const scroller = scrollerOf(row);
  if (!scroller) return;
  const box = scroller.getBoundingClientRect();

  if (centre) {
    scroller.scrollTop += item.top + item.height / 2 - (box.top + box.height / 2);
    return;
  }
  const edge = Math.min(EDGE, Math.max(0, (box.height - item.height) / 2));
  if (item.top < box.top + edge) scroller.scrollTop -= box.top + edge - item.top;
  else if (item.bottom > box.bottom - edge) scroller.scrollTop += item.bottom - box.bottom + edge;
}

/** A ring that fills with the share of the section the reader has read. */
function ReadRing({ percent }: { percent: number }) {
  return (
    <svg
      className="section-nav__ring"
      viewBox="0 0 16 16"
      aria-hidden="true"
      data-done={percent >= 100 || undefined}
    >
      <circle className="section-nav__ring-track" cx="8" cy="8" r="6" />
      <circle
        className="section-nav__ring-fill"
        cx="8"
        cy="8"
        r="6"
        pathLength="100"
        strokeDasharray={`${percent} 100`}
      />
      <circle className="section-nav__ring-core" cx="8" cy="8" r="2.75" />
    </svg>
  );
}

interface RowProps {
  row: OutlineRow;
  /** Rows keep one column for the chip, also a row without a code. */
  chips: boolean;
  current: boolean;
  changed: boolean;
  onPick: (id: string) => void;
}

/**
 * One row. It subscribes to the read share of its own section, so a new read
 * mark renders one row again, not the list.
 */
const Row = memo(function Row({ row, chips, current, changed, onPick }: RowProps) {
  const { section, kind, code, meta } = row;
  const percent = Math.round(useReadShare(section.id) * 100);

  return (
    <li>
      {/* A plain `<a href="#id">`, not a router `Link`: the browser goes to
          the heading, the router sees the new hash, and `ContentPage` pings
          the target. A `Link` does nothing when its hash is already in the
          address, and it forces `aria-current="page"`. */}
      <a
        className="section-nav__row"
        href={`#${section.id}`}
        title={section.text}
        data-kind={kind}
        data-current={current || undefined}
        aria-current={current ? "location" : undefined}
        onClick={() => onPick(section.id)}
      >
        {changed && (
          <span className="section-nav__changed" title={copy.changed}>
            <span className="sr-only">{copy.changed}. </span>
          </span>
        )}
        {kind === "section" && chips && (
          <span className="section-nav__code" data-empty={code ? undefined : ""}>
            {code}
          </span>
        )}
        <span className="section-nav__title">
          {kind === "part" && <span className="section-nav__part">{code}</span>}
          {section.title}
        </span>
        {meta && <span className="section-nav__time">{copy.minutes(section.minutes)}</span>}
        {meta && <ReadRing percent={percent} />}
        {meta && <span className="sr-only">{copy.labels.progress(percent)}</span>}
      </a>
    </li>
  );
});

interface SectionNavProps {
  document: MarkdownDocument;
  /** Runs when the reader picks a section. The sheet closes itself with it. */
  onNavigate?: () => void;
}

/**
 * The parts and their sections: where the reader is, what is read, what
 * changed. Used by the panel and by the sheet; it needs no parent of its own
 * and scrolls inside whatever box holds it.
 */
export function SectionNav({ document, onNavigate }: SectionNavProps) {
  const navRef = useRef<HTMLElement>(null);
  const current = useCurrentSection();
  const changed = useChangedSections();
  const outline = useMemo(() => outlineOf(document), [document]);

  // The rows are memoized: they get one function that never changes.
  const navigate = useRef(onNavigate);
  useEffect(() => {
    navigate.current = onNavigate;
  }, [onNavigate]);
  const pick = useCallback((id: string) => {
    // The hash is already this one: nothing changes for the router, so the
    // jump and the ping are done here.
    if (isAt(id)) jumpTo(id);
    navigate.current?.();
  }, []);

  // The current row stays in view while the reader moves through the document.
  useEffect(() => {
    const row = navRef.current?.querySelector("[data-current]");
    if (row) keepInView(row, false);
  }, [current]);

  // The list was hidden and shows now (the sheet opens), or its box changed:
  // the current row may be out of view.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    let shown = nav.getBoundingClientRect().height > 0;
    const observer = new ResizeObserver(() => {
      const row = nav.querySelector("[data-current]");
      const visible = nav.getBoundingClientRect().height > 0;
      if (row && visible) keepInView(row, !shown);
      shown = visible;
    });
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      ref={navRef}
      className="section-nav"
      aria-label={copy.labels.sections}
      style={{ "--code-length": outline.codeLength } as CSSProperties}
    >
      <ol>
        {outline.rows.map((row) => (
          <Row
            key={row.section.id}
            row={row}
            chips={outline.codeLength > 0}
            current={row.section.id === current}
            changed={changed.has(row.section.id)}
            onPick={pick}
          />
        ))}
      </ol>
    </nav>
  );
}
