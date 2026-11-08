import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { Link, useNavigate } from "@tanstack/react-router";

import { Ring } from "#/components/Dock";
import { TubeStage } from "#/components/TubeStage";
import { docWithId, library } from "#/lib/content";
import type { Doc } from "#/lib/content";
import { copy } from "#/lib/copy";
import { progressOf, usePrefs } from "#/lib/prefs";
import { prefersReducedMotion } from "#/lib/reduced-motion";
import { wordmark } from "#/lib/site";
import type { Stage } from "#/lib/tube-stage";

/** "≈ 12 min · 4 sections · 2 tables": what a document holds. A zero is not shown. */
function statsOf({ document }: Doc): string[] {
  const { stats } = document;
  return [
    copy.stats.minutes(stats.minutes),
    stats.sections > 0 && copy.stats.sections(stats.sections),
    stats.tables > 0 && copy.stats.tables(stats.tables),
  ].filter((chip) => chip !== false);
}

function stateOf(percent: number): string {
  if (percent >= 100) return copy.library.done;
  return percent > 0 ? copy.library.lit(percent) : copy.library.unlit;
}

/**
 * The library, `/content`, for one document or many: one card per
 * document, in reading order, with how much of it the reader has lit.
 *
 * The beam of the Enter page is still in the room: each card finds the
 * pointer in its own coordinates (`--x`, `--y`), once per frame, and its edge
 * glows where the light falls. Never through React state.
 *
 * Behind the cards stands a 3D room (`TubeStage`): one pod per document, the
 * rain in depth. A card under the pointer, or in focus, lifts its pod.
 */
export function LibraryPage() {
  const listRef = useRef<HTMLOListElement>(null);
  const headRef = useRef<HTMLElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const percents = usePrefs((prefs) => library.map((doc) => progressOf(prefs, doc.slug).percent));
  const here = usePrefs((prefs) => prefs.doc);
  const minutes = library.reduce((sum, doc) => sum + doc.document.stats.minutes, 0);
  const navigate = useNavigate();

  // An address from the days of one document, `/content#block`, opens the
  // document that has the block. Here and not in the route: a server never
  // sees the hash.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const doc = id ? docWithId(id) : undefined;
    if (doc)
      void navigate({ to: "/content/$slug", params: { slug: doc.slug }, hash: id, replace: true });
  }, [navigate]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    let frame = 0;
    let x = 0;
    let y = 0;

    const aim = () => {
      frame = 0;
      for (const card of list.querySelectorAll<HTMLElement>(".shelf-card")) {
        const box = card.getBoundingClientRect();
        card.style.setProperty("--x", `${(x - box.left).toFixed(1)}px`);
        card.style.setProperty("--y", `${(y - box.top).toFixed(1)}px`);
      }
      list.dataset.beam = "";
    };

    const onMove = (event: PointerEvent) => {
      // With less motion a card lights up whole, on hover (CSS).
      if (event.pointerType !== "mouse" || prefersReducedMotion()) return;
      x = event.clientX;
      y = event.clientY;
      frame ||= requestAnimationFrame(aim);
    };

    const onLeave = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      delete list.dataset.beam;
    };

    const listeners = new AbortController();
    const { signal } = listeners;
    window.addEventListener("pointermove", onMove, { signal });
    window.document.documentElement.addEventListener("pointerleave", onLeave, { signal });
    // The cards move under a still pointer: the light stays where it is.
    const onScroll = () => {
      if (list.dataset.beam !== undefined) frame ||= requestAnimationFrame(aim);
    };
    window.addEventListener("scroll", onScroll, { signal, passive: true });

    // The card under the pointer, or in focus, lifts its pod in the room.
    const lift = (event: Event) => {
      const card = (event.target as Element | null)?.closest<HTMLElement>(".shelf-card");
      stageRef.current?.focus(card ? Number(card.dataset.index) : null);
    };
    const drop = (event: FocusEvent | PointerEvent) => {
      const next = event.relatedTarget as Element | null;
      if (!next?.closest(".shelf-card")) stageRef.current?.focus(null);
    };
    list.addEventListener("pointerover", lift, { signal });
    list.addEventListener("focusin", lift, { signal });
    list.addEventListener("pointerout", drop, { signal });
    list.addEventListener("focusout", drop, { signal });

    return () => {
      listeners.abort();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <main className="library">
      {library.length > 0 && (
        <TubeStage
          anchor={headRef}
          stage={stageRef}
          tubes={library.map((doc, index) => ({
            percent: percents[index] ?? 0,
            here: doc.slug === here,
          }))}
        />
      )}
      <header ref={headRef} className="library__head">
        <Link to="/" className="library__home">
          {copy.labels.home}
        </Link>
        <p className="library__eyebrow">
          {copy.library.title} · {copy.library.eyebrow(library.length, minutes)}
        </p>
        <h1 className="library__title">
          {wordmark.map((row, index) => (
            <span key={index} className="library__row">
              {row}
            </span>
          ))}
        </h1>
      </header>

      {library.length === 0 ? (
        <p className="library__empty">{copy.library.empty}</p>
      ) : (
        <ol ref={listRef} className="library__list">
          {library.map((doc, index) => {
            const percent = percents[index] ?? 0;
            const isHere = doc.slug === here;
            return (
              <li key={doc.slug} style={{ "--i": index } as CSSProperties}>
                <Link
                  to="/content/$slug"
                  params={{ slug: doc.slug }}
                  className="shelf-card"
                  data-index={index}
                  data-here={isHere || undefined}
                  data-done={percent >= 100 || undefined}
                  style={{ "--read": percent / 100 } as CSSProperties}
                >
                  <span className="shelf-card__no" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="shelf-card__body">
                    <span className="shelf-card__file">
                      {doc.file}
                      {isHere && <span className="shelf-card__here">{copy.library.here}</span>}
                    </span>
                    <span className="shelf-card__title">{doc.title}</span>
                    <span className="shelf-card__stats">
                      {statsOf(doc).map((text) => (
                        <span key={text}>{text}</span>
                      ))}
                    </span>
                  </span>
                  <span className="shelf-card__state">
                    <Ring percent={percent} />
                    {stateOf(percent)}
                  </span>
                  <span className="shelf-card__bar" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
