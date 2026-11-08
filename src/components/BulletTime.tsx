import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

interface BulletTimeProps {
  /** The document column: the scene finds the title block in it. */
  root: RefObject<HTMLElement | null>;
  /** False while the rain of the page still falls: the scene waits for it. */
  start: boolean;
}

/**
 * Bullet time round the poster title (`lib/bullet-time.ts`). It comes once
 * the rain the page opens under has fallen away. Decorative:
 * hidden from assistive technology, never in the way of the pointer. `three`
 * loads only here, after the page is up; without WebGL, or without a title
 * block, the page is whole without it.
 */
export function BulletTime({ root, start }: BulletTimeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const header = root.current?.querySelector<HTMLElement>(".doc-header");
    if (!start || !canvas || !header) return;

    let gone = false;
    let mounted: { dispose(): void } | undefined;
    void import("#/lib/bullet-time")
      .then(({ mountBulletTime }) => {
        if (gone) return;
        mounted = mountBulletTime({ canvas, header, onReady: () => setReady(true) });
      })
      .catch(() => {
        // No WebGL, or the chunk did not load: the page stays as it is.
      });

    return () => {
      gone = true;
      mounted?.dispose();
    };
  }, [root, start]);

  return (
    <canvas
      ref={canvasRef}
      className="bullet-time"
      data-ready={ready || undefined}
      aria-hidden="true"
    />
  );
}
