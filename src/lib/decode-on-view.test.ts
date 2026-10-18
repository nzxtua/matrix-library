import { describe, expect, test } from "vite-plus/test";

import { DECODE_MS, decodeFrame, noiseFor, settleTimes } from "#/lib/decode-on-view";

describe("decodeFrame", () => {
  test("shows only the characters whose time has come", () => {
    const first = () => 0;
    expect(decodeFrame("SKILLS", 100, [0, 50, 100, 150, 200, 250], first)).toBe("SKIAAA");
  });

  test("keeps spaces and punctuation, so words keep their shape", () => {
    const frame = decodeFrame("R&D, 2026", 0, Array(9).fill(Infinity));
    expect(frame[1]).toBe("&");
    expect(frame[3]).toBe(",");
    expect(frame[4]).toBe(" ");
  });

  test("noise keeps the kind of each character: case and digits", () => {
    for (let run = 0; run < 50; run++) {
      const frame = decodeFrame("Ab 01", 0, Array(5).fill(Infinity));
      expect(frame).toMatch(/^[A-Z][a-z] [0-9][0-9]$/);
    }
  });

  test("is as long as the text at every step", () => {
    const settleAt = settleTimes(10);
    for (let elapsed = 0; elapsed <= DECODE_MS; elapsed += 40) {
      expect(decodeFrame("EXPERIENCE", elapsed, settleAt)).toHaveLength(10);
    }
  });
});

describe("settleTimes", () => {
  test("every character has settled by the end of the decode", () => {
    const text = "MASTER'S DEGREE IN COMPUTER SCIENCE";
    const settleAt = settleTimes(text.length);
    expect(decodeFrame(text, DECODE_MS, settleAt)).toBe(text);
  });

  test("runs from left to right when there is no jitter", () => {
    const times = settleTimes(5, () => 0);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]).toBeLessThan(times[4]);
  });

  test("nothing has settled at the start", () => {
    expect(Math.min(...settleTimes(3))).toBeGreaterThan(0);
  });
});

describe("noiseFor", () => {
  test("never swaps a character that is not a letter or a digit", () => {
    for (const char of [" ", "&", "?", "’", "("]) expect(noiseFor(char)).toBe(char);
  });
});
