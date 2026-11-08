import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { Stage, TubeState } from "#/lib/tube-stage";

interface TubeStageProps {
  /** The library header: the pods stand beside its wordmark. */
  anchor: RefObject<HTMLElement | null>;
  tubes: TubeState[];
  /** Filled once the room is up, so the cards can lift their pod. */
  stage: RefObject<Stage | null>;
}

/**
 * The 3D room behind the library (`lib/tube-stage.ts`). Decorative: hidden from
 * assistive technology, never in the way of the pointer. `three` loads only
 * here, after the page is up; without WebGL the library is whole without it.
 */
export function TubeStage({ anchor, tubes, stage }: TubeStageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tubesRef = useRef(tubes);
  tubesRef.current = tubes;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const head = anchor.current;
    if (!canvas || !head) return;

    let gone = false;
    let mounted: Stage | undefined;
    void import("#/lib/tube-stage")
      .then(({ mountStage }) => {
        if (gone) return;
        mounted = mountStage({
          canvas,
          anchor: head,
          tubes: tubesRef.current,
          onReady: () => setReady(true),
        });
        stage.current = mounted;
      })
      .catch(() => {
        // No WebGL, or the chunk did not load: the room stays dark.
      });

    return () => {
      gone = true;
      mounted?.dispose();
      stage.current = null;
    };
  }, [anchor, stage]);

  const key = tubes.map((tube) => `${tube.percent}${tube.here ? "*" : ""}`).join(",");
  useEffect(() => {
    stage.current?.setTubes(tubesRef.current);
  }, [key, stage]);

  return (
    <canvas
      ref={canvasRef}
      className="library__stage"
      data-ready={ready || undefined}
      aria-hidden="true"
    />
  );
}
