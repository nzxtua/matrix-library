import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import { copy } from "#/lib/copy";
import { clearHighlight, paintHighlight, rangesOf } from "#/lib/highlight";
import { useHotkeys } from "#/lib/hotkeys";
import { copyText, ping } from "#/lib/jump";
import type { MarkdownDocument, Section } from "#/lib/markdown";
import { getCurrentBlock, readingLine } from "#/lib/reading";
import { getUi, setEcho, useUi } from "#/lib/ui";

/** Space between the card and the viewport edge (the page gutter), and between the card and its code. */
const EDGE = 16;
const GAP = 8;
/** The card's text starts where the code starts: the card is moved left by its own padding. */
const INDENT = 13;

/** A click on one of these belongs to the control: it neither starts nor clears an echo. */
const CONTROLS = "a[href], button, input, select, textarea, summary, label, [role='button']";

interface Place {
  /** The `<code>` that holds the term. */
  host: HTMLElement;
  /** Id of the nav section the place is in. */
  section: string;
}

export interface SectionTally {
  id: string;
  code?: string;
  title: string;
  count: number;
  /** Index of the first place in this section. */
  first: number;
}

interface Found {
  term: string;
  places: Place[];
  tallies: SectionTally[];
}

/**
 * The places of a term, counted by section, in the order of the document.
 * `sectionIds` has one entry per place. A section the document does not list
 * (it has no headings) still gets a row, with its id as the title.
 */
export function tallySections(
  sectionIds: string[],
  sections: Pick<Section, "id" | "code" | "title">[],
): SectionTally[] {
  const known = new Map(sections.map((section) => [section.id, section]));
  const tallies = new Map<string, SectionTally>();

  sectionIds.forEach((id, index) => {
    const tally = tallies.get(id);
    if (tally) {
      tally.count += 1;
      return;
    }
    const section = known.get(id);
    tallies.set(id, {
      id,
      code: section?.code,
      title: section?.title ?? id,
      count: 1,
      first: index,
    });
  });

  return [...tallies.values()];
}

/**
 * Where the card goes, in viewport pixels: under the code, above it when
 * there is no room below, and always inside the viewport sideways. `keep`
 * holds the card in its column and on its side of the code while the reader
 * steps with its buttons, so the buttons stay under the pointer.
 */
export function placeCard(input: {
  anchor: { left: number; top: number; bottom: number };
  card: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Height that something else (the dock) takes at the bottom. */
  clear?: number;
  keep?: { x: number; above: boolean };
}): { x: number; y: number; above: boolean } {
  const { anchor, card, viewport, clear = 0, keep } = input;

  const maxX = Math.max(EDGE, viewport.width - card.width - EDGE);
  const x = Math.min(maxX, Math.max(EDGE, keep?.x ?? anchor.left - INDENT));

  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - card.height;
  const fitsBelow = below + card.height <= viewport.height - clear - EDGE;
  const fitsAbove = above >= EDGE;

  // With no room on either side the card goes below: its code stays readable.
  const goAbove = fitsAbove && (keep?.above ? true : !fitsBelow);
  return { x, y: goAbove ? above : below, above: goAbove };
}

/**
 * Which term the "e" key echoes: the term after the current one while the
 * reader stays in the same place, else the first term they can see.
 */
export function nextTerm(
  terms: string[],
  now: string | null,
  /** The current echo started from this same list. */
  here: boolean,
  /** Index of the first term on screen, or -1. */
  firstVisible: number,
): number {
  if (terms.length === 0) return -1;
  const index = now === null ? -1 : terms.indexOf(now);
  if (here && index !== -1) return (index + 1) % terms.length;
  return Math.max(0, firstVisible);
}

function isShown(element: Element): boolean {
  return element.getClientRects().length > 0;
}

function isOnScreen(element: Element): boolean {
  const box = element.getBoundingClientRect();
  return box.height > 0 && box.bottom > 0 && box.top < window.innerHeight;
}

function hasSelection(): boolean {
  const selection = window.getSelection();
  return selection !== null && !selection.isCollapsed && selection.toString().trim() !== "";
}

const TABBABLE =
  "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])";

/**
 * The control Tab reaches from a place in the document: the first one after
 * it, or with `back` the last one before it. The card lives at the end of the
 * page, so without this Tab would leave the card for the top of the page.
 */
function tabbableFrom(root: Element, from: Element, back: boolean): HTMLElement | null {
  const all = [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) => element.tabIndex >= 0 && isShown(element),
  );
  if (back) {
    return (
      all
        .reverse()
        .find(
          (element) =>
            (from.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING) !== 0 &&
            !element.contains(from),
        ) ?? null
    );
  }
  return (
    all.find(
      (element) => (from.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    ) ?? null
  );
}

/** The code terms of an element that the reader can see, one entry per term. */
function termsIn(scope: Element): { term: string; host: HTMLElement }[] {
  const seen = new Set<string>();
  const terms: { term: string; host: HTMLElement }[] = [];
  for (const host of scope.querySelectorAll<HTMLElement>("code[data-echo]")) {
    const term = host.textContent?.trim() ?? "";
    if (!term || seen.has(term) || !isShown(host)) continue;
    seen.add(term);
    terms.push({ term, host });
  }
  return terms;
}

/** The room the dock took at the bottom when it was last seen there. */
let dockRoom = 0;

/**
 * Height the dock takes at the bottom of the viewport: the card must not
 * rest on it. The dock hides while the reader scrolls down, so the last
 * height it was seen with counts. Without a dock: 0.
 */
function dockClearance(): number {
  const dock = window.document.querySelector(".dock");
  if (!dock) return 0;
  const box = dock.getBoundingClientRect();
  const room = window.innerHeight - box.top;
  if (box.height > 0 && room > 0 && room < 160 && box.bottom <= window.innerHeight + 1) {
    dockRoom = room;
  }
  return dockRoom;
}

/**
 * Echo: a click on a code term lights every place it appears and opens a
 * small card next to it.
 *
 * - One delegated `click` listener on `#doc` starts, moves and clears it.
 * - The card is `position: sticky` inside a rail as tall as the page: it
 *   scrolls with its code and rests at the edge of the viewport when the code
 *   leaves. Nothing is written while the page scrolls.
 * - Keyboard: "e" echoes the first code term of the current block and moves
 *   focus into the card; "e" again takes the next term of that block.
 */
export function Echo({ document: content }: { document: MarkdownDocument }) {
  const term = useUi((state) => state.echo);

  const [found, setFound] = useState<Found | null>(null);
  const [at, setAt] = useState(0);

  const railRef = useRef<HTMLDivElement>(null);
  const gapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef<HTMLButtonElement>(null);
  const copyRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);

  /** The code the reader picked, until the places of its term are known. */
  const wanted = useRef<HTMLElement | null>(null);
  /** The echo was started with the keyboard: focus goes into the card. */
  const byKeyboard = useRef(false);
  /** Where focus was before it went into the card. */
  const returnFocus = useRef<HTMLElement | null>(null);
  /** The column and the side the card keeps while the reader steps with its buttons. */
  const kept = useRef<{ x: number; above: boolean } | null>(null);
  /** Fresh values for the listeners that are attached once. */
  const live = useRef({ found, at });

  useEffect(() => {
    live.current = { found, at };
  });

  function place() {
    const rail = railRef.current;
    const gap = gapRef.current;
    const card = cardRef.current;
    const host = live.current.found?.places[live.current.at]?.host;
    if (!rail || !gap || !card || !host) return;

    // The rail is as tall as the page, so the card can rest anywhere on it.
    const page = rail.parentElement;
    if (page) rail.style.height = `${page.offsetTop + page.offsetHeight}px`;

    const lines = host.getClientRects();
    // A hidden place (a filtered row) has no position: the card stays.
    if (lines.length === 0) return;
    const box = host.getBoundingClientRect();
    const railBox = rail.getBoundingClientRect();
    const clear = dockClearance();

    const spot = placeCard({
      anchor: { left: lines[0].left, top: box.top, bottom: box.bottom },
      card: { width: card.offsetWidth, height: card.offsetHeight },
      viewport: {
        width: window.document.documentElement.clientWidth,
        height: window.innerHeight,
      },
      clear,
      keep: kept.current ?? undefined,
    });
    kept.current = { x: spot.x, above: spot.above };

    card.style.setProperty("--echo-clear", `${Math.round(clear)}px`);
    gap.style.height = `${Math.max(0, Math.round(spot.y - railBox.top))}px`;
    card.style.transform = `translateX(${Math.round(spot.x - railBox.left)}px)`;
  }

  /** Moves the card to another place of the same term, without a jump. */
  function reanchor(host: HTMLElement) {
    const index = live.current.found?.places.findIndex((entry) => entry.host === host) ?? -1;
    if (index === -1) return;
    kept.current = null;
    live.current.at = index;
    setAt(index);
    place();
  }

  /** Brings a place to the line the last one was on, and pings it. */
  function show(index: number) {
    const state = live.current;
    const next = state.found?.places[index];
    if (!state.found || !next) return;

    // A hidden place (a filtered row, a folded block) is shown by its block.
    const target = isShown(next.host)
      ? next.host
      : (next.host.closest<HTMLElement>(".doc__block") ?? next.host);

    // The page moves under the card: the next place lands where the last one
    // was, so the card and its buttons stay under the pointer.
    const from = state.found.places[state.at]?.host;
    const last = from && isOnScreen(from) ? from.getBoundingClientRect().top : readingLine();
    const line = Math.min(window.innerHeight - 96, Math.max(64, last));

    // First the scrollers inside the page (a wide table), then the page.
    target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    window.scrollBy({ top: target.getBoundingClientRect().top - line, behavior: "instant" });

    state.at = index;
    setAt(index);
    place();
    ping(target);
  }

  function step(by: 1 | -1) {
    const { found: state, at: index } = live.current;
    if (!state) return;
    const count = state.places.length;
    show((index + by + count) % count);
  }

  /** The "e" key. */
  function echoNext() {
    const root = window.document.getElementById("doc");
    if (!root) return;

    // The ruler marks what it holds; without it, the block under the reading line.
    const ruled = getUi().ruler ? root.querySelector<HTMLElement>("[data-ruler]") : null;
    const blockId = getCurrentBlock();
    let scope: Element | null =
      ruled ?? (blockId ? window.document.getElementById(blockId) : null) ?? root.firstElementChild;
    if (!scope) return;

    let terms = termsIn(scope);
    // No code here: the next row or block that has some.
    while (terms.length === 0) {
      const block: Element | null = scope.closest(".doc__block");
      scope =
        scope.nextElementSibling ?? (scope === block ? null : (block?.nextElementSibling ?? null));
      if (!scope) return;
      terms = termsIn(scope);
    }

    const state = live.current;
    const anchor = state.found?.places[state.at]?.host;
    const index = nextTerm(
      terms.map((entry) => entry.term),
      getUi().echo,
      anchor !== undefined && scope.contains(anchor),
      terms.findIndex((entry) => isOnScreen(entry.host)),
    );
    const picked = terms[index];
    if (!picked) return;

    if (!isOnScreen(picked.host)) {
      picked.host.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    }

    const active = window.document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== window.document.body &&
      !cardRef.current?.contains(active)
    ) {
      returnFocus.current = active;
    }

    if (getUi().echo === picked.term) {
      reanchor(picked.host);
      (stepRef.current ?? copyRef.current)?.focus({ preventScroll: true });
      return;
    }
    wanted.current = picked.host;
    byKeyboard.current = true;
    setEcho(picked.term);
  }

  useHotkeys([
    { keys: "e", label: copy.labels.echoKey, group: "find", run: echoNext },
    {
      keys: "escape",
      label: copy.labels.echoClear,
      group: "find",
      hidden: true,
      when: () => getUi().echo !== null && getUi().overlay === null,
      run: () => setEcho(null),
    },
  ]);

  // The one listener on the document: a click on a code term starts or moves
  // the echo; a plain click anywhere else in the document clears it.
  useEffect(() => {
    const root = window.document.getElementById("doc");
    if (!root) return;

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (!(event.target instanceof Element)) return;
      // The reader selected text: that is not a click.
      if (hasSelection()) return;

      const code = event.target.closest<HTMLElement>("code[data-echo]");
      const control = (code?.parentElement ?? event.target).closest(CONTROLS);
      if (control && root.contains(control)) return;

      const now = getUi().echo;
      if (!code) {
        if (now !== null) setEcho(null);
        return;
      }

      const picked = code.textContent?.trim() ?? "";
      if (!picked) return;
      byKeyboard.current = false;

      if (picked !== now) {
        wanted.current = code;
        setEcho(picked);
        return;
      }
      // The same term: a second click on the same place puts it out, a click
      // on another place moves the card there.
      const state = live.current;
      if (state.found?.places[state.at]?.host === code) setEcho(null);
      else reanchor(code);
    };

    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, []);

  // The term changed: find its places and light them.
  useLayoutEffect(() => {
    const root = window.document.getElementById("doc");
    if (term === null || !root) {
      setFound(null);
      return;
    }

    const ranges = rangesOf(root, term, { within: "code", exact: true });
    const places: Place[] = [];
    for (const range of ranges) {
      const host = range.startContainer.parentElement?.closest<HTMLElement>("code");
      if (!host) continue;
      const block = host.closest<HTMLElement>(".doc__block");
      places.push({ host, section: block?.dataset.section ?? "" });
    }

    const picked = wanted.current;
    wanted.current = null;
    if (places.length === 0) {
      // Nothing to light and nothing to stand next to.
      setEcho(null);
      return;
    }

    let index = picked ? places.findIndex((entry) => entry.host === picked) : -1;
    if (index === -1)
      index = Math.max(
        0,
        places.findIndex((entry) => isOnScreen(entry.host)),
      );

    paintHighlight("echo", ranges);
    kept.current = null;
    setFound({
      term,
      places,
      tallies: tallySections(
        places.map((entry) => entry.section),
        content.sections,
      ),
    });
    setAt(index);

    return () => clearHighlight("echo");
  }, [term, content]);

  // Put the card next to its code before the browser paints, and mark the code.
  useLayoutEffect(() => {
    const host = found?.places[at]?.host;
    if (!host) return;
    live.current = { ...live.current, found, at };
    place();
    host.setAttribute("data-echo-now", "");
    return () => host.removeAttribute("data-echo-now");
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `place` reads refs only
  }, [found, at]);

  // A new card. With the keyboard, focus goes into it and comes back after.
  useLayoutEffect(() => {
    if (!found) return;
    if (byKeyboard.current) {
      byKeyboard.current = false;
      (stepRef.current ?? copyRef.current)?.focus({ preventScroll: true });
    }
    return () => {
      // Runs before the next card too: only an echo that ended gives focus back.
      if (getUi().echo !== null) return;
      const back = returnFocus.current;
      returnFocus.current = null;
      const active = window.document.activeElement;
      const lost = active === null || active === window.document.body;
      if (back?.isConnected && (lost || cardRef.current?.contains(active))) {
        back.focus({ preventScroll: true });
      }
    };
  }, [found]);

  // The layout changed under the card: a resize, a table filter, an unfolded block.
  useEffect(() => {
    if (!found) return;
    const page = railRef.current?.parentElement;

    const onResize = () => {
      kept.current = null;
      place();
    };
    const observer = new ResizeObserver(() => place());
    if (page) observer.observe(page);
    window.addEventListener("resize", onResize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `place` reads refs only
  }, [found]);

  // A long list of sections: the row of the current place stays in view, and
  // the edge with more rows behind it fades (`data-more`).
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const row = list.querySelector<HTMLElement>("[aria-current]")?.parentElement;
    if (row) {
      // The list scrolls by itself; the page must not move.
      const top = row.offsetTop;
      const bottom = top + row.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = bottom - list.clientHeight;
      }
    }

    const edges = () => {
      const up = list.scrollTop > 1;
      const down = list.scrollTop + list.clientHeight < list.scrollHeight - 1;
      const more = up && down ? "both" : up ? "up" : down ? "down" : "";
      if (more) list.dataset.more = more;
      else delete list.dataset.more;
    };
    edges();
    list.addEventListener("scroll", edges, { passive: true });
    return () => list.removeEventListener("scroll", edges);
  }, [found, at]);

  if (!found || found.term !== term) return null;

  const count = found.places.length;
  const here = found.places[at]?.section;

  /** Tab out of the card goes on from its code in the document, not from the end of the page. */
  const onCardKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
    const card = cardRef.current;
    const host = found.places[at]?.host;
    const root = window.document.getElementById("doc");
    if (!card || !host || !root) return;

    const inside = [...card.querySelectorAll<HTMLElement>(TABBABLE)].filter(
      (element) => element.tabIndex >= 0 && isShown(element),
    );
    const edge = event.shiftKey ? inside[0] : inside[inside.length - 1];
    if (event.target !== edge) return;

    const next = tabbableFrom(root, host, event.shiftKey);
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  return (
    <div ref={railRef} className="echo">
      <div ref={gapRef} className="echo__gap" />
      <div
        key={found.term}
        ref={cardRef}
        className="echo__card"
        role="dialog"
        aria-label={`${copy.labels.echo}: ${found.term}`}
        onKeyDown={onCardKey}
      >
        <div className="echo__head">
          <span className="echo__ink" aria-hidden="true" />
          <code className="echo__term">{found.term}</code>
          <button
            ref={copyRef}
            type="button"
            className="echo__copy"
            onClick={() => void copyText(found.term)}
          >
            {copy.code.copy}
          </button>
        </div>

        <p className="echo__count" role="status">
          {copy.echo.count(count, found.tallies.length)}
        </p>

        <ol
          ref={listRef}
          className="echo__sections"
          aria-label={copy.labels.sections}
          data-codes={found.tallies.some((tally) => tally.code) || undefined}
        >
          {found.tallies.map((tally) => (
            <li key={tally.id}>
              <button
                type="button"
                className="echo__section"
                aria-current={tally.id === here ? "true" : undefined}
                onClick={() => show(tally.first)}
              >
                {tally.code && <span className="echo__code">{tally.code}</span>}
                <span className="echo__title">{tally.title}</span>
                <span className="echo__n">{tally.count}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="echo__foot">
          <button
            type="button"
            className="echo__step"
            aria-label={copy.labels.previous}
            disabled={count < 2}
            onClick={() => step(-1)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.5 10 8 5.5l4.5 4.5" />
            </svg>
          </button>
          <button
            ref={count < 2 ? undefined : stepRef}
            type="button"
            className="echo__step"
            aria-label={copy.labels.next}
            disabled={count < 2}
            onClick={() => step(1)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.5 6 8 10.5 12.5 6" />
            </svg>
          </button>
          <span className="echo__at" aria-hidden="true">
            <b>{at + 1}</b> / {count}
          </span>
          <button
            type="button"
            className="echo__close"
            aria-label={copy.labels.close}
            onClick={() => setEcho(null)}
          >
            <kbd>esc</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
