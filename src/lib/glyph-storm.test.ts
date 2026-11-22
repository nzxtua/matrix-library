import { describe, expect, test } from "vite-plus/test";

import { STORM_MS, centreOf, planStorm, stormFrame } from "#/lib/glyph-storm";

/** A small logo with holes, ragged lines and empty rows. */
const ART = ["   @@@@   ", " @@    @@ ", "@@  ##  @@", "", " @@    @@", "   @@@@   "].join("\n");

/** Positions of the characters that are not a space or a line break. */
const inked = (text: string) =>
  text.split("").flatMap((char, index) => (char === " " || char === "\n" ? [] : [index]));

describe("stormFrame", () => {
  const plan = planStorm(ART);
  const times = (kind: "reveal" | "ripple") =>
    Array.from({ length: 24 }, (_, step) => (step / 23) * STORM_MS[kind] * 0.999);

  test.each(["reveal", "ripple"] as const)(
    "a %s never draws outside the outline of the art, and keeps its lines",
    (kind) => {
      const ink = new Set(inked(ART));
      for (const elapsed of times(kind)) {
        const frame = stormFrame(plan, kind, centreOf(plan), elapsed);
        for (const layer of [frame.base, frame.spark]) {
          expect(layer.length).toBe(ART.length);
          expect(layer.split("\n").map((line) => line.length)).toEqual(
            ART.split("\n").map((line) => line.length),
          );
          for (const index of inked(layer)) expect(ink.has(index)).toBe(true);
        }
      }
    },
  );

  test.each(["reveal", "ripple"] as const)("a %s never draws a cell twice", (kind) => {
    for (const elapsed of times(kind)) {
      const frame = stormFrame(plan, kind, { column: 0, row: 0 }, elapsed);
      const base = new Set(inked(frame.base));
      for (const index of inked(frame.spark)) expect(base.has(index)).toBe(false);
    }
  });

  test("a reveal starts with nothing settled and ends with the art", () => {
    const first = stormFrame(plan, "reveal", centreOf(plan), 0);
    expect(inked(first.base)).toEqual([]);

    const last = stormFrame(plan, "reveal", centreOf(plan), STORM_MS.reveal);
    expect(last).toEqual({ base: ART, spark: ART.replace(/[^\n]/g, " "), done: true });
  });

  test("a ripple leaves the far side of the art in place while it is near the origin", () => {
    const frame = stormFrame(plan, "ripple", { column: 0, row: 0 }, STORM_MS.ripple * 0.15);
    const lastLine = ART.lastIndexOf("\n") + 1;

    expect(frame.done).toBe(false);
    expect(frame.base.slice(lastLine)).toBe(ART.slice(lastLine));
  });

  test("halfway through, a reveal has settled the centre, scrambles a ring, hides the rim", () => {
    const frame = stormFrame(plan, "reveal", centreOf(plan), STORM_MS.reveal * 0.5);
    const total = inked(ART).length;
    const settled = inked(frame.base).length;
    const scrambled = inked(frame.spark).length;

    expect(settled).toBeGreaterThan(0);
    expect(scrambled).toBeGreaterThan(0);
    expect(settled + scrambled).toBeLessThan(total);
  });

  test("an art without ink is done at once", () => {
    const empty = planStorm("    \n    ");
    expect(stormFrame(empty, "reveal", centreOf(empty), 0).done).toBe(true);
  });
});
