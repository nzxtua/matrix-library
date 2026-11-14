import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

interface WaterStageProps {
  /** The document column: the water finds the card of the next document in it. */
  root: RefObject<HTMLElement | null>;
  /** False while the rain of the page still falls: the scene waits for it. */
  start: boolean;
}

/**
 * The water under the card of the next document (`lib/water-stage.ts`). It
 * comes once the rain the page opens under has fallen away. Decorative:
 * hidden from assistive technology, never in the way of the pointer. `three`
 * loads only here; without WebGL, or with one document only (no card), the
 * page is whole without it.
 */
export function WaterStage({ root, start }: WaterStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const column = root.current;
    const card = column?.querySelector<HTMLElement>(".doc-next__card");
    if (!start || !canvas || !column || !card) return;

    let gone = false;
    let mounted: { dispose(): void } | undefined;
    void import("#/lib/water-stage")
      .then(({ mountWater }) => {
        if (gone) return;
        mounted = mountWater({ canvas, card, root: column, onReady: () => setReady(true) });
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
    <canvas ref={canvasRef} className="water" data-ready={ready || undefined} aria-hidden="true" />
  );
}
