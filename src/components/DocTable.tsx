import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { flushSync } from "react-dom";
import type { Tokens } from "marked";

import { renderInline } from "#/components/Inline";
import { copy } from "#/lib/copy";
import { paintHighlight, rangesOf } from "#/lib/highlight";
import { copyText, jumpTo, linkTo } from "#/lib/jump";
import { plainText, rowIds, rowText } from "#/lib/markdown";
import { clamp } from "#/lib/math";
import { prefersReducedMotion } from "#/lib/reduced-motion";
import { hasEveryWord, queryWords } from "#/lib/search";

/* ───────────────────────────── Pure logic ───────────────────────────── */

type Row = Tokens.TableCell[];

/** A table with at least this many rows gets the filter field. */
const FILTER_FROM_ROWS = 8;

/** A first cell this short reads as a key, whatever it holds. */
const SHORT_KEY = 24;
/** A longer first cell is a key when this share of its text is code. */
const CODE_SHARE = 0.6;

const cellText = (cell: Tokens.TableCell) => plainText(cell.tokens);

function isKeyCell(cell: Tokens.TableCell): boolean {
  const text = cellText(cell).trim();
  if (text === "") return false;
  if (text.length <= SHORT_KEY) return true;
  let code = 0;
  for (const token of cell.tokens) {
    if (token.type === "codespan") code += (token as Tokens.Codespan).text.length;
  }
  return code / text.length >= CODE_SHARE;
}

/**
 * The first column is the key column when most of its cells are short or
 * code: a name, a number, a file path. It is decided from the cells, never
 * from the heading.
 */
export function hasKeyColumn(table: Pick<Tokens.Table, "header" | "rows">): boolean {
  if (table.header.length < 2 || table.rows.length === 0) return false;
  const keys = table.rows.filter((row) => row[0] && isKeyCell(row[0])).length;
  return keys * 2 > table.rows.length;
}

/**
 * Which rows the filter keeps: a row stays when it holds every word of the
 * query, in any cell, in any case. An empty query keeps every row.
 */
export function filterRows(rows: Row[], query: string): boolean[] {
  const words = queryWords(query);
  return rows.map((row) => hasEveryWord(rowText(row), words));
}

const ALIGN_RULE = { left: ":---", center: ":---:", right: "---:" } as const;

/** The table as Markdown: the heading and the rows that `visible` keeps. */
export function toMarkdown(table: Tokens.Table, visible?: boolean[]): string {
  // A pipe ends a cell, in code too: every pipe is written escaped.
  const line = (row: Row) =>
    `| ${row.map((cell) => cell.text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ")).join(" | ")} |`;
  const rule = `| ${table.align.map((align) => (align ? ALIGN_RULE[align] : "---")).join(" | ")} |`;
  const rows = table.rows.filter((_, index) => visible?.[index] ?? true);
  return [line(table.header), rule, ...rows.map(line)].join("\n");
}

/** The table as tab-separated text, for a spreadsheet: what the reader sees, no markup. */
export function toTsv(table: Tokens.Table, visible?: boolean[]): string {
  // A tab or a line break inside a cell would shift the grid.
  const line = (row: Row) =>
    row
      .map((cell) =>
        cellText(cell)
          .replace(/\s*[\t\n\r]\s*/g, " ")
          .trim(),
      )
      .join("\t");
  const rows = table.rows.filter((_, index) => visible?.[index] ?? true);
  return [line(table.header), ...rows.map(line)].join("\n");
}

/* ───────────────────────────── Column plan ──────────────────────────── */

/** Average widths of one character, in rem: mono key, body cell, heading. */
const KEY_CHAR = 0.5;
const TEXT_CHAR = 0.44;
const HEAD_CHAR = 0.5;
/** Short values are dates, numbers and capitals: wider than running text. */
const VALUE_CHAR = 0.56;
/** Left and right padding of a cell, in rem. */
const CELL_PAD = 2;
/** The column of the row link button, in rem. */
const ACTION_COLUMN = 2.75;

const rem = (value: number) => `${Math.round(value * 100) / 100}rem`;

/**
 * The column tracks, from all the rows. The widths never depend on the rows
 * that are on screen, so the filter cannot make a column jump.
 *
 * A key column and a column of short values take the room their text needs.
 * Prose columns share what is left: a column with more to say gets more.
 */
function planColumns(table: Tokens.Table, key: boolean): { template: string; min: number } {
  const count = table.header.length;
  const columns = table.header.map((head, column) => {
    const lengths = table.rows
      .map((row) => (row[column] ? cellText(row[column]).trim().length : 0))
      .sort((a, b) => a - b);
    const longest = lengths[lengths.length - 1] ?? 0;
    // The long tail does not set the width: three quarters of the cells do.
    const typical = lengths[Math.round((lengths.length - 1) * 0.75)] ?? 0;
    const words = cellText(head).trim().split(/\s+/);
    const headWord = Math.max(...words.map((word) => word.length)) * HEAD_CHAR + CELL_PAD;
    const headLine = cellText(head).trim().length * HEAD_CHAR + CELL_PAD;

    if (key && column === 0) {
      // A path fits on one line where there is room: two columns leave more.
      const ideal = clamp(longest * KEY_CHAR + CELL_PAD, 5, count > 2 ? 20 : 32);
      const width = Math.max(ideal, headWord);
      return { min: Math.max(Math.min(width, 9), headWord), max: rem(width), grow: 0 };
    }

    const line = longest * VALUE_CHAR + CELL_PAD;
    if (line <= 10) {
      // Short values: one line, and the heading on one line when it is short too.
      const width = Math.max(line, headLine <= 10 ? headLine : headWord, 4);
      return { min: width, max: rem(width), grow: 0 };
    }

    const min = Math.max(
      clamp(typical * TEXT_CHAR + CELL_PAD, 9, typical > 160 ? 13 : 11),
      headWord,
    );
    return { min, max: "", grow: Math.max(Math.sqrt(typical), 3) };
  });

  // Something has to take the room that is left.
  if (columns.every((column) => column.grow === 0)) {
    for (const [index, column] of columns.entries()) {
      if (!(key && index === 0) || count === 1) column.grow = column.min;
    }
  }

  const tracks = columns.map((column) =>
    column.grow > 0
      ? `minmax(${rem(column.min)}, ${Math.round(column.grow * 100) / 100}fr)`
      : `minmax(${rem(column.min)}, ${column.max})`,
  );
  return {
    template: [...tracks, rem(ACTION_COLUMN)].join(" "),
    min: columns.reduce((sum, column) => sum + column.min, ACTION_COLUMN),
  };
}

/* ─────────────────────────────── Copy menu ──────────────────────────── */

type Format = "markdown" | "tsv";

/** Room the open menu needs under the button, in CSS pixels. */
const MENU_ROOM = 132;
const MENU_GAP = 6;

/**
 * `copy`, with a menu: as Markdown or as TSV. The menu is a popover: it opens
 * in the top layer, so no card clips it. It hangs from the right edge of the
 * button and follows it while the page scrolls.
 */
function CopyMenu({ onCopy }: { onCopy: (format: Format) => void }) {
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;

    const place = () => {
      const rect = button.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        // The button left the screen: a menu that hangs from nothing closes.
        if (menu.matches(":popover-open")) menu.hidePopover();
        return;
      }
      const above = window.innerHeight - rect.bottom < MENU_ROOM && rect.top > MENU_ROOM;
      menu.style.top = above ? "auto" : `${rect.bottom + MENU_GAP}px`;
      menu.style.bottom = above ? `${window.innerHeight - rect.top + MENU_GAP}px` : "auto";
      menu.style.right = `${Math.max(8, document.documentElement.clientWidth - rect.right)}px`;
    };

    let frame = 0;
    const follow = () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };

    // Placed before it shows: the menu never appears in the wrong spot.
    const onBeforeToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") place();
    };
    const onToggle = (event: Event) => {
      const isOpen = (event as ToggleEvent).newState === "open";
      setOpen(isOpen);
      stop();
      if (!isOpen) return;
      window.addEventListener("scroll", follow, { capture: true, passive: true });
      window.addEventListener("resize", follow);
      menu.querySelector<HTMLElement>("[role='menuitem']")?.focus({ preventScroll: true });
    };

    menu.addEventListener("beforetoggle", onBeforeToggle);
    menu.addEventListener("toggle", onToggle);
    return () => {
      stop();
      menu.removeEventListener("beforetoggle", onBeforeToggle);
      menu.removeEventListener("toggle", onToggle);
    };
  }, []);

  const close = () => {
    if (menuRef.current?.matches(":popover-open")) menuRef.current.hidePopover();
    buttonRef.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>("[role='menuitem']")];
    const at = items.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (event.key === "ArrowDown") next = items[(at + 1) % items.length];
    else if (event.key === "ArrowUp") next = items[(at - 1 + items.length) % items.length];
    else if (event.key === "Home") next = items[0];
    else if (event.key === "End") next = items[items.length - 1];
    else if (event.key === "Escape" || event.key === "Tab") {
      // The key is used up here: it must not reach the page hotkeys.
      event.preventDefault();
      close();
      return;
    } else return;
    event.preventDefault();
    next?.focus({ preventScroll: true });
  };

  const pick = (format: Format) => {
    close();
    onCopy(format);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="dtable__copy"
        popoverTarget={menuId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
      >
        {copy.code.copy}
        <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
          <path d="M2 3.75 5 6.75 8 3.75" />
        </svg>
      </button>
      <div
        ref={menuRef}
        id={menuId}
        className="dtable__menu"
        popover="auto"
        role="menu"
        aria-label={copy.code.copy}
        onKeyDown={onKeyDown}
      >
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => pick("markdown")}>
          {copy.labels.asMarkdown}
        </button>
        <button type="button" role="menuitem" tabIndex={-1} onClick={() => pick("tsv")}>
          {copy.labels.asTsv}
        </button>
      </div>
    </>
  );
}

/* ───────────────────────────────── Row ──────────────────────────────── */

const copyRowLink = (id: string) => void copyText(linkTo(id), copy.linkCopied);

interface RowProps {
  id: string;
  row: Row;
  /** The heading of every column: the caption of a cell in the stacked layout. */
  labels: string[];
  keyColumn: boolean;
  hidden: boolean;
}

/** Memoized: the filter changes `hidden` on a few rows, the rest do not render. */
const TableRow = memo(function TableRow({ id, row, labels, keyColumn, hidden }: RowProps) {
  return (
    <tr id={id} role="row" hidden={hidden}>
      {row.map((cell, column) => {
        const isKey = keyColumn && column === 0;
        const Tag = isKey ? "th" : "td";
        return (
          <Tag
            key={column}
            role={isKey ? "rowheader" : "cell"}
            scope={isKey ? "row" : undefined}
            data-label={labels[column] || undefined}
            style={cell.align ? { textAlign: cell.align } : undefined}
          >
            {renderInline(cell.tokens)}
          </Tag>
        );
      })}
      <td role="cell" className="dtable__act">
        <button type="button" aria-label={copy.labels.rowLink} onClick={() => copyRowLink(id)}>
          <span aria-hidden="true">#</span>
        </button>
      </td>
    </tr>
  );
});

/* ──────────────────────────────── Table ─────────────────────────────── */

/**
 * A table, as a card. `id` is the id of its block: the row ids start with it.
 *
 *   <div class="doc__table dtable" data-fit data-key>
 *     <div class="dtable__bar">        filter, count, copy menu
 *     <div class="dtable__scroll">     scrolls sideways only when the table does not fit
 *       <table> … <tr id="{id}-{hash}"> …
 *     <p class="dtable__empty">        the filter found nothing
 *
 * `data-fit` is measured: a table that fits its track does not scroll, so its
 * heading can stick to the top of the page. A table that does not fit scrolls
 * sideways and its key column sticks to the left instead.
 */
export function DocTable({ token, id }: { token: Tokens.Table; id: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const bodyId = useId();
  const [query, setQuery] = useState("");

  const total = token.rows.length;
  const filterable = total >= FILTER_FROM_ROWS;

  const { ids, labels, keyColumn, plan } = useMemo(() => {
    const keyColumn = hasKeyColumn(token);
    return {
      ids: rowIds(id, token.rows),
      labels: token.header.map((cell) => cellText(cell).trim()),
      keyColumn,
      plan: planColumns(token, keyColumn),
    };
  }, [token, id]);

  const visible = useMemo(() => filterRows(token.rows, query), [token, query]);
  const shown = visible.reduce((sum, keep) => sum + (keep ? 1 : 0), 0);
  const words = useMemo(() => queryWords(query), [query]);
  const filtering = words.length > 0;

  // Fit: does the table, at its smallest comfortable width, fit the card?
  useLayoutEffect(() => {
    const root = rootRef.current;
    const scroll = scrollRef.current;
    const table = tableRef.current;
    if (!root || !scroll || !table) return;

    let fits: boolean | undefined;
    const measure = () => {
      // The width of the table is the same in both modes, so this cannot flap.
      const next = table.offsetWidth <= scroll.clientWidth + 1;
      if (next === fits) return;
      fits = next;
      root.dataset.fit = String(next);
      // A box that scrolls must be reachable by keyboard.
      if (next) {
        scroll.removeAttribute("tabindex");
        scroll.removeAttribute("role");
        scroll.removeAttribute("aria-label");
        scroll.removeAttribute("data-scrolled");
      } else {
        scroll.tabIndex = 0;
        scroll.setAttribute("role", "region");
        scroll.setAttribute("aria-label", copy.table.scroll);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    observer.observe(table);

    // The key column covers what scrolls under it only once something does.
    const onScroll = () => {
      const scrolled = scroll.scrollLeft > 0;
      if (scrolled !== scroll.hasAttribute("data-scrolled")) {
        scroll.toggleAttribute("data-scrolled", scrolled);
      }
    };
    scroll.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", onScroll);
    };
  }, []);

  // What the filter found glows in the rows that stay: the `filter`
  // highlight (styled in `table.css`), shared by every table.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || words.length === 0) return;
    const ranges: Range[] = [];
    for (const cell of body.querySelectorAll("tr:not([hidden]) > :not(.dtable__act)")) {
      for (const word of words) ranges.push(...rangesOf(cell, word));
    }
    paintHighlight("filter", ranges, id);
    return () => paintHighlight("filter", [], id);
  }, [id, words]);

  // A hidden row cannot be shown to the reader. When something points at one
  // (a link to the row, a search jump), the filter gives way and the jump is
  // made again.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !filtering) return;
    const observer = new MutationObserver((records) => {
      const row = records.find(
        ({ target }) =>
          target instanceof HTMLTableRowElement &&
          target.hidden &&
          target.hasAttribute("data-ping"),
      )?.target as HTMLTableRowElement | undefined;
      if (!row) return;
      // The rows must be back in the layout before the jump is made again.
      flushSync(() => setQuery(""));
      jumpTo(row);
    });
    observer.observe(body, { attributes: true, attributeFilter: ["data-ping"], subtree: true });
    return () => observer.disconnect();
  }, [filtering]);

  // The row light and the heading of the column under the pointer.
  const light = useRef({ frame: 0, x: 0, y: 0, row: null as HTMLElement | null, column: -1 });

  const setColumn = (column: number) => {
    const state = light.current;
    if (state.column === column) return;
    const heads = tableRef.current?.tHead?.rows[0]?.cells;
    heads?.[state.column]?.removeAttribute("data-lit");
    heads?.[column]?.setAttribute("data-lit", "");
    state.column = column;
  };

  const onPointerMove = (event: PointerEvent<HTMLTableSectionElement>) => {
    if (event.pointerType === "touch") return;
    const cell = (event.target as Element).closest<HTMLTableCellElement>("th, td");
    const row = cell?.parentElement;
    if (!cell || !row) return;

    setColumn(cell.classList.contains("dtable__act") ? -1 : cell.cellIndex);

    const state = light.current;
    state.row = row;
    state.x = event.clientX;
    state.y = event.clientY;
    state.frame ||= requestAnimationFrame(() => {
      state.frame = 0;
      // Calm: the row is lit evenly, the light does not follow.
      if (!state.row || prefersReducedMotion()) return;
      const rect = state.row.getBoundingClientRect();
      // On this row only: nothing else recalculates.
      state.row.style.setProperty("--mx", `${Math.round(state.x - rect.left)}px`);
      state.row.style.setProperty("--my", `${Math.round(state.y - rect.top)}px`);
    });
  };

  const onPointerLeave = () => setColumn(-1);

  useEffect(() => {
    const state = light.current;
    return () => cancelAnimationFrame(state.frame);
  }, []);

  const onFilterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    // Escape clears the filter. On an empty field it lets go of the field.
    event.preventDefault();
    if (query) setQuery("");
    else event.currentTarget.blur();
  };

  const onCopy = (format: Format) =>
    void copyText(format === "markdown" ? toMarkdown(token, visible) : toTsv(token, visible));

  return (
    <div
      ref={rootRef}
      className="doc__table dtable"
      data-key={keyColumn || undefined}
      data-filtering={filtering || undefined}
      style={{ "--dt-cols": plan.template, "--dt-min": rem(plan.min) } as CSSProperties}
    >
      <div className="dtable__bar">
        {filterable ? (
          <label className="dtable__filter">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M1.5 3h13L9.5 8.75v3.5l-3 1.5v-5z" />
            </svg>
            <input
              type="text"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={query}
              placeholder={copy.table.filter(total)}
              aria-label={copy.table.filter(total)}
              aria-controls={bodyId}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onFilterKeyDown}
            />
            {query ? (
              <button
                type="button"
                className="dtable__clear"
                aria-label={copy.table.clear}
                onClick={(event) => {
                  setQuery("");
                  event.currentTarget.parentElement?.querySelector("input")?.focus();
                }}
              >
                <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
                  <path d="M2 2l6 6M8 2l-6 6" />
                </svg>
              </button>
            ) : null}
          </label>
        ) : null}
        {/* One count: how many rows, or how many of them the filter kept. */}
        <span className="dtable__count" aria-live={filterable ? "polite" : undefined}>
          {filtering ? copy.labels.rows(shown, total) : filterable ? "" : copy.table.count(total)}
        </span>
        <CopyMenu onCopy={onCopy} />
      </div>

      <div ref={scrollRef} className="dtable__scroll">
        <table ref={tableRef} role="table">
          <thead role="rowgroup">
            <tr role="row">
              {token.header.map((cell, index) => (
                <th
                  key={index}
                  role="columnheader"
                  scope="col"
                  style={cell.align ? { textAlign: cell.align } : undefined}
                >
                  {renderInline(cell.tokens)}
                </th>
              ))}
              <td role="presentation" className="dtable__act" />
            </tr>
          </thead>
          <tbody
            ref={bodyRef}
            id={bodyId}
            role="rowgroup"
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
          >
            {token.rows.map((row, index) => (
              <TableRow
                key={ids[index]}
                id={ids[index]}
                row={row}
                labels={labels}
                keyColumn={keyColumn}
                hidden={!visible[index]}
              />
            ))}
          </tbody>
        </table>
      </div>

      {shown === 0 && total > 0 ? <p className="dtable__empty">{copy.table.empty}</p> : null}
    </div>
  );
}
