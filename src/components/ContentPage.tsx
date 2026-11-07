import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "@tanstack/react-router";

import { BulletTime } from "#/components/BulletTime";

import { Curtain } from "#/components/Curtain";
import { Dock } from "#/components/Dock";
import { Echo } from "#/components/Echo";
import { Keymap } from "#/components/Keymap";
import { Markdown } from "#/components/Markdown";
import { Minimap } from "#/components/Minimap";
import { Panel } from "#/components/Panel";
import { ProgressLine } from "#/components/ProgressLine";
import { Resume } from "#/components/Resume";
import { Ruler } from "#/components/Ruler";
import { DocNext, DocShelf } from "#/components/Shelf";
import { Sheet } from "#/components/Sheet";
import { Spotlight } from "#/components/Spotlight";
import { Toast } from "#/components/Toast";
import { Torch } from "#/components/Torch";
import { WaterStage } from "#/components/WaterStage";
import { docBySlug, library, logoUrl } from "#/lib/content";
import type { Doc } from "#/lib/content";
import { copy } from "#/lib/copy";
import { jumpTo, ping } from "#/lib/jump";
import { createFlashlight } from "#/lib/matrix-flashlight";
import type { Flashlight } from "#/lib/matrix-flashlight";
import { getPrefs, openDoc } from "#/lib/prefs";
import { startReading } from "#/lib/reading";
import { prefersReducedMotion } from "#/lib/reduced-motion";
import { closeOverlay, getUi, setEcho, setRuler, setSearchlight, setTorch } from "#/lib/ui";
import { useVibe, vibeById } from "#/lib/vibes";

/** The rain stays this long before it starts to fall away. */
const RAIN_HOLD_MS = 350;

/**
 * While the page is in a tab the reader left, the tab title says the light is
 * still on. The title comes back with the reader. Lights out swaps the title
 * itself: while the curtain is down the title is left alone.
 */
function useAwayTitle() {
  useEffect(() => {
    /** The title before the reader left, while the away title shows. */
    let before: string | null = null;

    const restore = () => {
      if (before !== null && window.document.title === copy.away) window.document.title = before;
      before = null;
    };

    const onVisibility = () => {
      if (!window.document.hidden) {
        restore();
        return;
      }
      if (before !== null || getUi().overlay === "curtain") return;
      before = window.document.title;
      window.document.title = copy.away;
    };

    window.document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.document.removeEventListener("visibilitychange", onVisibility);
      restore();
    };
  }, []);
}

/** The route `/content/$slug`: one page per document, built anew for each. */
export function DocPage() {
  const slug = useParams({ from: "/content/$slug", select: (params) => params.slug });
  const doc = docBySlug(slug);
  return doc ? <ContentPage key={doc.slug} doc={doc} /> : null;
}

/**
 * The content page of one document. It composes the parts and owns five
 * things: the reading tracker, the rain the page opens under, the ping of a hash target, the tab
 * title while the reader is away, and the reset of the tools when the reader
 * leaves.
 *
 * Grid (`.doc-page` in `styles/tokens.css`): document | minimap | panel.
 * Everything else is fixed or a dialog.
 */
function ContentPage({ doc }: { doc: Doc }) {
  // The reading progress of this document comes off the shelf before any
  // part renders: the parts read it on mount (`Resume`, the minimap).
  useState(() => openDoc(doc.slug));

  const { document: content, slug } = doc;
  const docRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rainRef = useRef<Flashlight | null>(null);
  const [raining, setRaining] = useState(() => !prefersReducedMotion());
  const vibe = useVibe();
  const hash = useLocation({ select: (location) => location.hash });

  // The blocks are in the DOM now: follow the reader through them.
  useEffect(() => {
    const root = docRef.current;
    if (!root) return;
    return startReading(content, root, slug);
  }, [content, slug]);

  // The tools belong to this page. The store outlives it, so what is open
  // or on is put away when the reader leaves: an overlay left open would
  // also keep the keys of the Enter page off.
  useEffect(
    () => () => {
      closeOverlay();
      setRuler(false);
      setTorch(false);
      setEcho(null);
      setSearchlight(null);
    },
    [],
  );

  useAwayTitle();

  // The page opens under the same rain the Enter page ended with; the rain
  // then falls away and leaves the content.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rain = createFlashlight(canvas, {
      flooded: true,
      palette: vibeById(getPrefs().vibe).rain,
    });
    rainRef.current = rain;
    const timer = window.setTimeout(() => {
      rain.drain(() => {
        rain.destroy();
        rainRef.current = null;
        setRaining(false);
      });
    }, RAIN_HOLD_MS);

    return () => {
      window.clearTimeout(timer);
      rain.destroy();
      rainRef.current = null;
    };
  }, []);

  // The reader changed the light while the rain still falls.
  useEffect(() => {
    rainRef.current?.setPalette(vibe.rain);
  }, [vibe]);

  // Arriving with a hash: go there once, and ping the target when the reader
  // can see it. The hash comes from the router, so a link inside the page and
  // a pasted address behave the same.
  const arrivedAt = useRef<string | null>(null);
  useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(hash);
    if (!target) return;
    if (arrivedAt.current !== hash) {
      arrivedAt.current = hash;
      jumpTo(target, { ping: false });
    }
    // Under the rain a ping would be lost. It waits for the rain to end.
    if (!raining) ping(target);
  }, [hash, raining]);

  return (
    <>
      <div className="doc-page" data-intro={raining || undefined}>
        <BulletTime root={docRef} start={!raining} />
        <WaterStage root={docRef} start={!raining} />
        <ProgressLine />
        <main ref={docRef} className="doc" id="doc">
          <DocShelf doc={doc} />
          <Markdown document={content} />
          <DocNext doc={doc} />
        </main>
        <Minimap document={content} />
        <Panel document={content} logoUrl={logoUrl} title={doc.title} start={!raining} />
        <Dock document={content} />
        <Sheet document={content} />
        <Resume document={content} />
        <Spotlight document={content} slug={slug} library={library} />
        <Echo document={content} />
        <Ruler document={content} />
        <Torch />
        <Curtain />
        <Keymap />
        <Toast />
      </div>

      {raining && <canvas ref={canvasRef} className="doc-rain" aria-hidden="true" />}
    </>
  );
}
