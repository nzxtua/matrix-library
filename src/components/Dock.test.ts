import { describe, expect, test } from "vite-plus/test";

import { nextDockScroll } from "#/components/Dock";
import type { DockScroll } from "#/components/Dock";

const VIEWPORT = 800;
const AT_TOP: DockScroll = { y: 0, anchor: 0, away: false };

/** The state after the page passed through every position, one scroll event each. */
function scroll(positions: number[], from: DockScroll = AT_TOP): DockScroll {
  return positions.reduce((state, y) => nextDockScroll(state, y, VIEWPORT, false), from);
}

describe("nextDockScroll", () => {
  test("the dock stays while the reader is near the top", () => {
    expect(scroll([30, 60, 90]).away).toBe(false);
  });

  test("it leaves once the reader scrolls down past the top", () => {
    expect(scroll([60, 120, 180]).away).toBe(true);
  });

  test("a small step down is not enough to send it away", () => {
    const shown = scroll([60, 120, 180, 150]);
    expect(shown.away).toBe(false);
    expect(scroll([170, 190], shown).away).toBe(false);
    expect(scroll([170, 190, 215], shown).away).toBe(true);
  });

  test("a shaky wheel does not bring it back; a real scroll up does", () => {
    const away = scroll([60, 200, 400, 600]);
    expect(scroll([590, 600, 585], away).away).toBe(true);
    expect(scroll([590, 570], away).away).toBe(false);
  });

  test("the way up is measured from the lowest point, not from where it left", () => {
    const away = scroll([60, 200, 400, 900]);
    // 20 px up from 900. Measured from 200, where it left, it would never return.
    expect(scroll([880], away).away).toBe(true);
    expect(scroll([880, 870], away).away).toBe(false);
  });

  test("a jump changes nothing, in either direction", () => {
    const away = scroll([60, 200, 400, 600]);
    expect(scroll([5000], away).away).toBe(true);
    expect(scroll([5000, 3000], away).away).toBe(true);

    const shown = scroll([590, 570], away);
    expect(scroll([6000], shown).away).toBe(false);
  });

  test("after a jump the reader has to scroll again before it leaves", () => {
    const shown = scroll([60, 200, 400, 600, 570, 6000]);
    expect(scroll([6040], shown).away).toBe(false);
    expect(scroll([6040, 6080], shown).away).toBe(true);
  });

  test("it is back at the top and at the end of the page", () => {
    const away = scroll([60, 200, 400, 600]);
    // A jump to the top: without the rule for the top, a jump changes nothing.
    expect(scroll([5000, 50], away).away).toBe(false);
    expect(nextDockScroll(away, 640, VIEWPORT, true).away).toBe(false);
  });
});
