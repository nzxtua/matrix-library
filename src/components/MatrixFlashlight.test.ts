import { describe, expect, test } from "vite-plus/test";

import { clickBurst } from "#/components/MatrixFlashlight";

/** Clicks at these times; whether any of them made a burst. */
function burstAt(times: number[]): boolean {
  let kept: number[] = [];
  let burst = false;
  for (const time of times) {
    const next = clickBurst(kept, time);
    kept = next.times;
    burst ||= next.burst;
  }
  return burst;
}

describe("clickBurst", () => {
  test("six fast clicks drain the battery; five do not", () => {
    expect(burstAt([0, 200, 400, 600, 800])).toBe(false);
    expect(burstAt([0, 200, 400, 600, 800, 1000])).toBe(true);
  });

  test("the six must fall within 2 s", () => {
    expect(burstAt([0, 450, 900, 1350, 1800, 2250])).toBe(false);
    // Old clicks drop out; the newest six count.
    expect(burstAt([0, 1000, 1500, 1700, 1900, 2100, 2300, 2500])).toBe(true);
  });

  test("a burst starts the count over", () => {
    const after = clickBurst([0, 100, 200, 300, 400], 500);
    expect(after.burst).toBe(true);
    expect(clickBurst(after.times, 600).burst).toBe(false);
  });
});
