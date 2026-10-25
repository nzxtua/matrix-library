import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";

import { Comfort } from "#/components/Comfort";
import { LogoStage } from "#/components/LogoStage";
import { SectionNav } from "#/components/SectionNav";
import { copy } from "#/lib/copy";
import type { MarkdownDocument } from "#/lib/markdown";
import { prefersReducedMotion } from "#/lib/reduced-motion";

/** The most characters per line of the ASCII logo (no WebGL). A short window gets fewer. */
const LOGO_COLUMNS = 76;

interface PanelProps {
  document: MarkdownDocument;
  logoUrl: string;
  /** The title of the document: the name of the logo. */
  title: string;
  /** The page is in view (its opening rain is gone): the logo may build itself. */
  start: boolean;
}

/**
 * The sticky panel on the right: the logo (the link home), the navigation,
 * the comfort settings. Root class: `.panel` (the page grid places it).
 * Below 60rem it is hidden: the dock and the sheet take over.
 */
export function Panel({ document, logoUrl, title, start }: PanelProps) {
  const logoRef = useRef<HTMLAnchorElement>(null);

  // The ASCII logo (no WebGL): a small beam follows the pointer over it. Its
  // place is written on the logo itself, once per frame, and never through
  // React state. The 3D logo aims its own torch (`lib/logo-stage.ts`).
  useEffect(() => {
    const logo = logoRef.current;
    if (!logo) return;

    let frame = 0;
    let x = 0;
    let y = 0;

    const aim = () => {
      frame = 0;
      const art = logo.querySelector(".ascii");
      if (!art) return;
      const box = art.getBoundingClientRect();
      logo.style.setProperty("--beam-x", `${(x - box.left).toFixed(1)}px`);
      logo.style.setProperty("--beam-y", `${(y - box.top).toFixed(1)}px`);
      logo.dataset.beam = "";
    };

    const onMove = (event: PointerEvent) => {
      // With less motion the whole logo is lit instead (CSS, on hover).
      if (prefersReducedMotion()) {
        delete logo.dataset.beam;
        return;
      }
      x = event.clientX;
      y = event.clientY;
      frame ||= requestAnimationFrame(aim);
    };

    const onLeave = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      delete logo.dataset.beam;
    };

    const listeners = new AbortController();
    const { signal } = listeners;
    logo.addEventListener("pointermove", onMove, { signal });
    logo.addEventListener("pointerleave", onLeave, { signal });
    logo.addEventListener("pointercancel", onLeave, { signal });

    return () => {
      listeners.abort();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <aside className="panel">
      <Link ref={logoRef} to="/" className="panel__logo" aria-label={copy.labels.home}>
        <LogoStage
          src={logoUrl}
          columns={LOGO_COLUMNS}
          label={title}
          host={logoRef}
          start={start}
        />
      </Link>
      <SectionNav document={document} />
      <Comfort />
    </aside>
  );
}
