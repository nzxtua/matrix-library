import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";

import { Icon, Keycaps } from "#/components/Keymap";
import { copy } from "#/lib/copy";
import { TOOL_KEYS, formatKeys } from "#/lib/hotkeys";
import type { MarkdownDocument } from "#/lib/markdown";
import {
  onScrollProgress,
  useCurrentBlock,
  useCurrentSection,
  useReadPercent,
} from "#/lib/reading";
import { prefersReducedMotion } from "#/lib/reduced-motion";
import { toast } from "#/lib/toast";
import { openOverlay, setRuler, setTorch, useUi } from "#/lib/ui";

/** The dock leaves after the reader scrolls this far down, in CSS pixels. */
const HIDE_AFTER = 56;
/** It returns after this far up. */
const SHOW_AFTER = 24;
/** Near the top of the page it always stays. */
const TOP_ZONE = 96;
/** One step longer than this share of the viewport is a jump, not reading. */
const JUMP_SHARE = 0.9;
/** A mouse this close to the bottom edge calls the dock back, in CSS pixels. */
const REACH = 96;

export interface DockScroll {
  /** The last scroll position. */
  y: number;
  /** Where the reader turned: the highest point while shown, the lowest while away. */
  anchor: number;
  away: boolean;
}

/**
 * Whether the dock stays after a scroll to `y`. It leaves when the reader
 * scrolls down and returns when the reader scrolls up, with some slack both
 * ways so a shaky wheel does not make it blink. It always stays near the top
 * and at the end of the page. A jump (a link, a search result) changes
 * nothing: the reader did not ask for the tools, and did not send them away.
 */
export function nextDockScroll(
  prev: DockScroll,
  y: number,
  viewport: number,
  atEnd: boolean,
): DockScroll {
  if (y <= TOP_ZONE || atEnd) return { y, anchor: y, away: false };
  if (Math.abs(y - prev.y) > viewport * JUMP_SHARE) return { y, anchor: y, away: prev.away };

  if (prev.away) {
    const anchor = Math.max(prev.anchor, y);
    return anchor - y > SHOW_AFTER ? { y, anchor: y, away: false } : { y, anchor, away: true };
  }
  const anchor = Math.min(prev.anchor, y);
  return y - anchor > HIDE_AFTER ? { y, anchor: y, away: true } : { y, anchor, away: false };
}

export function IconSearch() {
  return (
    <Icon>
      <circle cx="9" cy="9" r="5.25" />
      <path d="m13 13 3.75 3.75" />
    </Icon>
  );
}

/** A reading band: one line in the light, the lines around it dim. */
export function IconRuler() {
  return (
    <Icon>
      <path d="M4 4.25h12M4 15.75h9" opacity="0.45" />
      <rect x="2.75" y="7.5" width="14.5" height="5" rx="1.5" />
    </Icon>
  );
}

/** A torch held at an angle: the head, the handle with its switch, and the light it throws. */
export function IconTorch() {
  return (
    <Icon>
      <g transform="rotate(40 10 10)">
        <path d="M6.25 7h7.5v.9c0 1.1-1.75 1.6-1.75 3v5.35a1.25 1.25 0 0 1-1.25 1.25h-1.5A1.25 1.25 0 0 1 8 16.25V10.9c0-1.4-1.75-1.9-1.75-3Z" />
        <path d="M10 12.5v1.25" />
        <path d="M10 2.25v2M5.6 3.4l1.15 1.45M14.4 3.4l-1.15 1.45" opacity="0.55" />
      </g>
    </Icon>
  );
}

export function IconLightsOut() {
  return (
    <Icon>
      <path d="M16.25 11.6A6.75 6.75 0 1 1 8.4 3.75a5.25 5.25 0 0 0 7.85 7.85Z" />
    </Icon>
  );
}

/** Two chevrons: this opens a list to pick from. */
function IconPick() {
  return (
    <Icon>
      <path d="m6.5 8 3.5-3.5L13.5 8M6.5 12l3.5 3.5 3.5-3.5" />
    </Icon>
  );
}

/**
 * The read share of the document as a ring. `key` on the flash restarts its
 * one glow whenever the share grows: the ring gets lit, it does not move.
 * `percent` is a whole number, 0..100, as `useReadPercent` gives it.
 */
export function Ring({ percent: value }: { percent: number }) {
  return (
    <svg
      className="ring"
      viewBox="0 0 36 36"
      data-done={value >= 100 || undefined}
      aria-hidden="true"
      focusable="false"
    >
      <circle className="ring__track" cx="18" cy="18" r="15" />
      {value > 0 && (
        <>
          <circle
            className="ring__value"
            cx="18"
            cy="18"
            r="15"
            pathLength={100}
            strokeDasharray={`${value} 100`}
          />
          <circle
            key={value}
            className="ring__flash"
            cx="18"
            cy="18"
            r="15"
            pathLength={100}
            strokeDasharray={`${value} 100`}
          />
        </>
      )}
    </svg>
  );
}

/**
 * Says `copy.read.done` once, when the reader lights the last block. A page
 * that loads with everything read already says nothing: the share is compared
 * only after reading has started, when it holds the stored value.
 */
function ReadDone() {
  const percent = useReadPercent();
  const started = useCurrentBlock() !== undefined;
  const before = useRef<number | null>(null);

  useEffect(() => {
    if (!started) {
      before.current = null;
      return;
    }
    if (before.current !== null && before.current < 100 && percent >= 100) toast(copy.read.done);
    before.current = percent;
  }, [percent, started]);

  return null;
}

function two(n: number): string {
  return String(n).padStart(2, "0");
}

/** The name of a key for `aria-keyshortcuts`. */
function ariaKeys(keys: string): string {
  return formatKeys(keys)
    .map((cap) => (cap === "⌘" ? "Meta" : cap === "ctrl" ? "Control" : cap))
    .join("+");
}

interface ToolProps {
  label: string;
  keys: string;
  onClick: () => void;
  pressed?: boolean;
  expanded?: boolean;
  children: ReactNode;
}

/** A round tool button of the pill. Its tooltip shows the name and the key. */
function Tool({ label, keys, onClick, pressed, expanded, children }: ToolProps) {
  return (
    <button
      type="button"
      className="dock__tool dock__desk"
      aria-label={label}
      aria-keyshortcuts={ariaKeys(keys)}
      aria-pressed={pressed}
      aria-haspopup={expanded === undefined ? undefined : "dialog"}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {children}
      <span className="dock__tip" aria-hidden="true">
        {label}
        <Keycaps keys={keys} />
      </span>
    </button>
  );
}

/**
 * The reader's tools. On a desktop: a solid pill at the bottom centre of the
 * document column, which leaves while the reader scrolls down. On a phone: a
 * solid bottom bar with the current section (it opens the sheet), search and
 * the read ring.
 *
 * The buttons only talk to the ui store; the overlays belong to other owners.
 * `.dock` is the pill itself (a stable class, for a view transition from the
 * Enter pill); `.dock-slot` only places it.
 */
export function Dock({ document: doc }: { document: MarkdownDocument }) {
  const dockRef = useRef<HTMLDivElement>(null);
  const overlay = useUi((state) => state.overlay);
  const ruler = useUi((state) => state.ruler);
  const torch = useUi((state) => state.torch);
  const percent = useReadPercent();
  const current = useCurrentSection();

  const index = doc.sections.findIndex((section) => section.id === current);
  const section = index >= 0 ? doc.sections[index] : undefined;

  // Leaves on the way down, returns on the way up. The state lives on the
  // element: scrolling never renders.
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;

    let state: DockScroll = { y: window.scrollY, anchor: window.scrollY, away: false };
    const apply = () => {
      if (dock.hasAttribute("data-away") !== state.away) {
        dock.toggleAttribute("data-away", state.away);
      }
    };
    const comeBack = () => {
      state = { y: window.scrollY, anchor: window.scrollY, away: false };
      apply();
    };

    const stopProgress = onScrollProgress((progress) => {
      state = nextDockScroll(state, window.scrollY, window.innerHeight, progress >= 0.999);
      if (state.away) {
        // With calm motion nothing leaves. A dock in use stays too: under the
        // pointer, or with the keyboard focus on it.
        if (prefersReducedMotion() || dock.matches(":hover, :has(:focus-visible)")) {
          comeBack();
          return;
        }
        // A button that was clicked keeps the focus. Out of sight it must not
        // keep the Space key as well.
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && dock.contains(focused)) focused.blur();
      }
      apply();
    });

    const onPointerMove = (event: PointerEvent) => {
      if (!state.away || event.pointerType !== "mouse") return;
      if (event.clientY > window.innerHeight - REACH) comeBack();
    };

    const listeners = new AbortController();
    const { signal } = listeners;
    window.addEventListener("pointermove", onPointerMove, { passive: true, signal });
    dock.addEventListener("focusin", comeBack, { signal });

    return () => {
      stopProgress();
      listeners.abort();
    };
  }, []);

  // The light of the pointer on the pill. Written on the pill only.
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;
    const dock = event.currentTarget;
    dock.style.setProperty(
      "--mx",
      `${Math.round(event.clientX - dock.getBoundingClientRect().left)}px`,
    );
  };

  return (
    // In the dark of the torch the dock stays lit: `data-torch` lifts it over the dark.
    <div className="dock-slot" inert={overlay === "curtain"} data-torch={torch || undefined}>
      <ReadDone />
      <div
        ref={dockRef}
        className="dock"
        role="group"
        aria-label={copy.labels.tools}
        onPointerMove={onPointerMove}
      >
        <button
          type="button"
          className="dock__where"
          aria-haspopup="dialog"
          aria-expanded={overlay === "sheet"}
          onClick={() => openOverlay("sheet")}
        >
          <span className="dock__ring">
            <Ring percent={percent} />
            <span className="dock__ring-number" aria-hidden="true">
              {percent}
            </span>
          </span>
          <span className="dock__where-text">
            <span className="sr-only">{copy.labels.menu}. </span>
            {section ? (
              <>
                <span className="dock__eyebrow">
                  {two(index + 1)} / {two(doc.sections.length)}
                  {section.code && <span className="dock__code">{section.code}</span>}
                </span>
                <span key={section.id} className="dock__title">
                  {section.title}
                </span>
              </>
            ) : (
              <span className="dock__title" aria-hidden="true">
                {copy.labels.menu}
              </span>
            )}
            <span className="sr-only"> {copy.labels.progress(percent)}</span>
          </span>
          <IconPick />
        </button>

        <button
          type="button"
          className="dock__search"
          aria-label={copy.search.placeholder}
          aria-keyshortcuts={ariaKeys(TOOL_KEYS.search)}
          aria-haspopup="dialog"
          aria-expanded={overlay === "spotlight"}
          onClick={() => openOverlay("spotlight")}
        >
          <IconSearch />
          <span className="dock__search-label dock__desk">{copy.search.placeholder}</span>
          <Keycaps keys={TOOL_KEYS.search} className="dock__desk" />
        </button>

        <span className="dock__rule dock__desk" aria-hidden="true" />

        <Tool
          label={copy.labels.ruler}
          keys={TOOL_KEYS.ruler}
          pressed={ruler}
          onClick={() => setRuler(!ruler)}
        >
          <IconRuler />
        </Tool>
        <Tool
          label={copy.labels.torch}
          keys={TOOL_KEYS.torch}
          pressed={torch}
          onClick={() => setTorch(!torch)}
        >
          <IconTorch />
        </Tool>
        <Tool
          label={copy.labels.lightsOut}
          keys={TOOL_KEYS.lightsOut}
          onClick={() => openOverlay("curtain")}
        >
          <IconLightsOut />
        </Tool>

        <span className="dock__rule dock__desk" aria-hidden="true" />

        <span
          className="dock__read dock__desk"
          role="img"
          aria-label={copy.labels.progress(percent)}
        >
          <Ring percent={percent} />
          <span className="dock__percent" aria-hidden="true">
            {percent}%
          </span>
          <span className="dock__tip" aria-hidden="true">
            {copy.labels.progress(percent)}
          </span>
        </span>

        <Tool
          label={copy.labels.keys}
          keys={TOOL_KEYS.keys}
          expanded={overlay === "keymap"}
          onClick={() => openOverlay("keymap")}
        >
          <span className="dock__glyph" aria-hidden="true">
            ?
          </span>
        </Tool>
      </div>
    </div>
  );
}
