import { useEffect, useRef } from "react";

import { onScrollProgress } from "#/lib/reading";

/**
 * The 2 px accent line at the top: how far down the page the reader is.
 * Decoration: the read ring of the dock says the share in words.
 * The progress is written on the line itself, never to state.
 */
export function ProgressLine() {
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fill = fillRef.current;
    if (!fill) return;
    return onScrollProgress((progress) => {
      fill.style.transform = `scaleX(${progress.toFixed(4)})`;
    });
  }, []);

  return (
    <div className="progress-line" aria-hidden="true">
      <div ref={fillRef} className="progress-line__fill" />
    </div>
  );
}
