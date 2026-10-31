import { describe, expect, test } from "vite-plus/test";

import { AFTERGLOW_HALF_LIFE, afterglow, morse, outage, stepAt } from "#/lib/matrix-flashlight";
import type { PowerStep } from "#/lib/matrix-flashlight";

/** The glow after `seconds` in frames of `dt`, from `from`, with `light` on the ink. */
function glowAfter(from: number, light: number, seconds: number, dt: number): number {
  let glow = from;
  for (let t = 0; t < seconds - 1e-9; t += dt) glow = afterglow(glow, light, dt);
  return glow;
}

/** Start times of every drop in power of at least 0.1 (the start of a flash). */
function drops(steps: readonly PowerStep[]): number[] {
  const times: number[] = [];
  let level = 1;
  let t = 0;
  for (const step of steps) {
    if (level - step.level >= 0.1) times.push(t);
    level = step.level;
    t += step.seconds;
  }
  return times;
}

/** The most drops that fall in any one second. */
function mostDropsInASecond(steps: readonly PowerStep[]): number {
  const times = drops(steps);
  return Math.max(
    0,
    ...times.map((start) => times.filter((t) => t >= start && t < start + 1).length),
  );
}

const SOS = morse("... --- ...", 0.2, 0.15);
const OUTAGES = [
  outage({ spare: false, calm: false }),
  outage({ spare: true, calm: false }),
  outage({ spare: false, calm: true }),
  outage({ spare: true, calm: true }),
];

describe("afterglow", () => {
  test("light that arrives shows at once", () => {
    expect(afterglow(0.1, 0.9, 1 / 60)).toBe(0.9);
  });

  test("light that leaves halves its excess in one half-life", () => {
    expect(glowAfter(1, 0, AFTERGLOW_HALF_LIFE, 1 / 60)).toBeCloseTo(0.5, 3);
    // It fades toward the light that still reaches the ink, not toward 0.
    expect(glowAfter(0.8, 0.2, AFTERGLOW_HALF_LIFE, 1 / 60)).toBeCloseTo(0.5, 3);
  });

  test("the fade is the same at any frame rate", () => {
    expect(glowAfter(1, 0, 1, 1 / 30)).toBeCloseTo(glowAfter(1, 0, 1, 1 / 144), 6);
  });

  test("it reaches the dark exactly, in finite time", () => {
    expect(glowAfter(1, 0, 2, 1 / 60)).toBeGreaterThan(0.2);
    expect(glowAfter(1, 0, 12, 1 / 60)).toBe(0);
  });
});

describe("stepAt", () => {
  const steps: PowerStep[] = [
    { level: 0, seconds: 0.5 },
    { level: 1, seconds: 0.25 },
  ];

  test("finds the step that plays, each one from its start", () => {
    expect(stepAt(steps, 0)).toBe(0);
    expect(stepAt(steps, 0.49)).toBe(0);
    expect(stepAt(steps, 0.5)).toBe(1);
  });

  test("is over after the last step", () => {
    expect(stepAt(steps, 0.75)).toBe(-1);
    expect(stepAt([], 0)).toBe(-1);
  });
});

describe("morse", () => {
  const marks = SOS.filter((step) => step.level === 1).map((step) => step.seconds);

  test("SOS is three short, three long, three short", () => {
    expect(marks.map((seconds) => (seconds > 0.3 ? "-" : "."))).toEqual(Array.from("...---..."));
  });

  test("a dash is three dots; gaps are one unit inside a letter, three between letters", () => {
    expect(marks[0]).toBeCloseTo(0.2);
    expect(marks[3]).toBeCloseTo(0.6);
    const gaps = SOS.slice(1, -1)
      .filter((step) => step.level !== 1)
      .map((step) => Math.round(step.seconds / 0.2));
    expect(gaps).toEqual([1, 1, 3, 1, 1, 3, 1, 1]);
  });

  test("never goes dark between the marks, and pauses before and after", () => {
    expect(Math.min(...SOS.map((step) => step.level))).toBe(0.15);
    expect(SOS[0]).toMatchObject({ level: 0.15 });
    expect(SOS.at(-1)).toMatchObject({ level: 0.15 });
  });
});

describe("outage", () => {
  test("no signal flashes more than three times in a second", () => {
    for (const steps of [SOS, ...OUTAGES]) expect(mostDropsInASecond(steps)).toBeLessThanOrEqual(3);
  });

  test("the beam sputters before it dies; with less motion it only fades out", () => {
    expect(drops(OUTAGES[0]).length).toBeGreaterThan(1);
    expect(drops(OUTAGES[2])).toHaveLength(1);
    expect(drops(OUTAGES[3])).toHaveLength(1);
  });

  test("the dark lasts about 2 s, and a spare battery cuts it short", () => {
    const dark = (steps: PowerStep[]) =>
      steps.filter((step) => step.level === 0).reduce((sum, step) => sum + step.seconds, 0);
    expect(dark(OUTAGES[0])).toBeGreaterThanOrEqual(2);
    expect(dark(OUTAGES[1])).toBeLessThan(1);
    expect(dark(OUTAGES[3])).toBeLessThan(dark(OUTAGES[2]));
  });

  test("says dead then back, or swapped when there is a spare", () => {
    const cues = (steps: PowerStep[]) => steps.flatMap((step) => (step.cue ? [step.cue] : []));
    expect(cues(OUTAGES[0])).toEqual(["dead", "back"]);
    expect(cues(OUTAGES[1])).toEqual(["swapped"]);
    expect(cues(OUTAGES[2])).toEqual(["dead", "back"]);
    expect(cues(OUTAGES[3])).toEqual(["swapped"]);
  });
});
