import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";

import { AsciiImage } from "#/components/AsciiImage";
import type { LogoStage as Stage } from "#/lib/logo-stage";

interface LogoStageProps {
  src: string;
  label: string;
  /**
   * The most characters per line of the ASCII logo: the one shown without
   * WebGL, and the glyphs of the 3D logo's glyph storm.
   */
  columns: number;
  /** Takes the pointer and the focus for the torch: the link around the logo. */
  host: RefObject<HTMLElement | null>;
  /** The page is in view (its opening rain is gone): the relief may build itself. */
  start: boolean;
}

/**
 * Resolves once the mono font can draw the glyph storm. A font that fails to
 * load is not an error: the fallback font draws it instead.
 */
async function monoReady(): Promise<void> {
  const mono = getComputedStyle(document.documentElement).getPropertyValue("--mono").trim();
  try {
    await document.fonts.load(`700 1em ${mono || "monospace"}`, "coeas0235689SCOGQ#@%&");
  } catch {
    // Draw with whatever font the browser has.
  }
}

/**
 * The logo as a 3D relief (`lib/logo-stage.ts`). `three` loads only here,
 * after the page is up. Without WebGL, or if the logo has no ink to trace,
 * the logo is drawn in ASCII instead (`AsciiImage`).
 * Styles: `.logo3d` in `styles/panel.css`.
 */
export function LogoStage({ src, label, columns, host, start }: LogoStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<Stage | null>(null);
  const startRef = useRef(start);
  startRef.current = start;
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  /** Width over height of the picture, once it is decoded. */
  const [aspect, setAspect] = useState(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = canvas?.parentElement;
    const anchor = host.current;
    // The light may fill the logo's corner of the panel, not only its box.
    const room = anchor?.parentElement ?? anchor;
    if (!canvas || !frame || !anchor || !room) return;

    let gone = false;
    let stage: Stage | undefined;
    setState("loading");

    const image = new Image();
    const load = () => {
      image.src = src;
      Promise.all([image.decode(), import("#/lib/logo-stage"), monoReady()])
        .then(([, { mountLogo }]) => {
          if (gone) return;
          setAspect(image.naturalWidth / Math.max(image.naturalHeight, 1));
          stage = mountLogo({
            canvas,
            frame,
            room,
            host: anchor,
            image,
            columns,
            onReady: () => setState("ready"),
          });
          stageRef.current = stage;
          if (startRef.current) stage.start();
        })
        .catch(() => {
          // No WebGL, no ink, or the chunk did not load: the ASCII logo stands in.
          if (!gone) setState("failed");
        });
    };

    // Nothing loads while the logo has no size: the panel is hidden on a
    // narrow screen, and there `three` and the trace would be work for nothing.
    const sized = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width <= 0) return;
      sized.disconnect();
      load();
    });
    sized.observe(frame);

    return () => {
      gone = true;
      sized.disconnect();
      stage?.dispose();
      stageRef.current = null;
    };
  }, [src, host, columns]);

  useEffect(() => {
    if (start) stageRef.current?.start();
  }, [start]);

  if (state === "failed") {
    return <AsciiImage src={src} columns={columns} label={label} beam storm />;
  }

  return (
    <div
      className="logo3d"
      data-ready={state === "ready" ? "" : undefined}
      style={{ "--logo-aspect": aspect } as CSSProperties}
    >
      <canvas ref={canvasRef} className="logo3d__canvas" role="img" aria-label={label} />
    </div>
  );
}
