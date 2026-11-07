import { useEffect, useId, useState } from "react";

import { Keycaps } from "#/components/Keymap";
import { copy } from "#/lib/copy";
import { useHotkeys } from "#/lib/hotkeys";
import { jumpTo } from "#/lib/jump";
import type { MarkdownDocument } from "#/lib/markdown";
import { getPrefs, setPrefs } from "#/lib/prefs";
import { prefersReducedMotion } from "#/lib/reduced-motion";
import { getUi, useUi } from "#/lib/ui";

/** The card waits for the rain the page opens under. */
const WAIT_MS = 1700;
/** Without the rain (calm motion) it only waits for the page to settle. */
const WAIT_CALM_MS = 500;
/** The fade of the card, as in `dock.css`. */
const LEAVE_MS = 260;
/** This much scroll is "the first scroll", in CSS pixels. Less is a shaky hand. */
const SCROLL_SLACK = 48;
/** A position in the first screen is not worth a card: this share of the viewport. */
const NEAR_TOP = 0.75;

const MARK = "\u0000";

interface Target {
  blockId: string;
  code?: string;
  name: string;
}

type Phase = "wait" | "shown" | "leaving" | "gone";

/** Where the reader stopped, when this is a fresh load without a hash. */
function findTarget(doc: MarkdownDocument): Target | null {
  if (typeof window === "undefined" || window.location.hash.length > 1) return null;
  const { last } = getPrefs();
  const block = last === null ? undefined : doc.blocks.find((known) => known.id === last);
  if (!block) return null;
  const section = doc.sections.find((known) => known.id === block.sectionId);
  return { blockId: block.id, code: section?.code, name: section?.title ?? copy.resume.nowhere };
}

function idle(): boolean {
  const ui = getUi();
  // The torch and the ruler take Escape before the card (see the Escape order).
  return (
    ui.overlay === null && ui.echo === null && ui.searchlight === null && !ui.torch && !ui.ruler
  );
}

/**
 * The card that offers to go back to where the reader stopped. It never
 * scrolls by itself. It comes once the page is lit and leaves with the first
 * scroll: a reader who starts to read has answered.
 *
 * Keys while it is up: Enter picks up, Escape puts the card away.
 */
export function Resume({ document: doc }: { document: MarkdownDocument }) {
  // Read once: the tracker overwrites `prefs.last` as soon as the reader moves.
  const [target] = useState(() => findTarget(doc));
  const [phase, setPhase] = useState<Phase>(target ? "wait" : "gone");
  const curtain = useUi((state) => state.overlay === "curtain");
  const textId = useId();

  useEffect(() => {
    if (!target) return;
    const startY = window.scrollY;
    /** The listener is needed until the first scroll, or until the card will never show. */
    const listening = new AbortController();

    const timer = window.setTimeout(
      () => {
        const element = document.getElementById(target.blockId);
        const top = element ? element.getBoundingClientRect().top + window.scrollY : 0;
        const shown = top > window.innerHeight * NEAR_TOP;
        if (!shown) listening.abort();
        setPhase(shown ? "shown" : "gone");
      },
      prefersReducedMotion() ? WAIT_CALM_MS : WAIT_MS,
    );

    // The first scroll. Before the card is up it means: never show it (the
    // browser restored the position, or the reader is already on the way).
    const onScroll = () => {
      if (Math.abs(window.scrollY - startY) <= SCROLL_SLACK) return;
      window.clearTimeout(timer);
      listening.abort();
      setPhase((now) => (now === "shown" ? "leaving" : now === "wait" ? "gone" : now));
    };
    window.addEventListener("scroll", onScroll, { passive: true, signal: listening.signal });

    return () => {
      window.clearTimeout(timer);
      listening.abort();
    };
  }, [target]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const timer = window.setTimeout(() => setPhase("gone"), LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const pickUp = () => {
    if (target) jumpTo(target.blockId, { focus: true });
    setPhase("leaving");
  };

  const startOver = () => {
    // The position is forgotten. What the reader has read stays read.
    setPrefs({ last: null });
    setPhase("leaving");
  };

  useHotkeys(
    phase === "shown"
      ? [
          {
            keys: "enter",
            label: copy.resume.go,
            group: "read",
            hidden: true,
            when: idle,
            run: pickUp,
          },
          {
            keys: "escape",
            label: copy.labels.close,
            group: "read",
            hidden: true,
            when: idle,
            run: () => setPhase("leaving"),
          },
        ]
      : [],
  );

  if (!target || phase === "gone") return null;

  const up = phase === "shown" || phase === "leaving";
  const [before, after = ""] = copy.resume.text(MARK).split(MARK);
  const place = target.code ? `${target.code} ${target.name}` : target.name;

  return (
    <div className="resume-slot" inert={curtain || phase === "leaving"}>
      {/* The region exists before its text: a screen reader says the text when it arrives. */}
      <p className="sr-only" role="status">
        {phase === "shown" ? copy.resume.text(place) : ""}
      </p>
      {up && (
        <section
          className="resume"
          data-leaving={phase === "leaving" || undefined}
          aria-labelledby={textId}
        >
          <span className="resume__lamp" aria-hidden="true" />
          <p id={textId} className="resume__text">
            {before}
            <b className="resume__place">
              {target.code && <span className="resume__code">{target.code}</span>}
              {target.name}
            </b>
            {after}
          </p>
          <div className="resume__actions">
            <button type="button" className="resume__go" aria-keyshortcuts="Enter" onClick={pickUp}>
              {copy.resume.go}
              <Keycaps keys="enter" />
            </button>
            <button type="button" className="resume__reset" onClick={startOver}>
              {copy.resume.reset}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
