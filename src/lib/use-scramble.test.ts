import { describe, expect, test } from "vite-plus/test";

import { scrambleFrame } from "#/lib/use-scramble";

describe("scrambleFrame", () => {
  const noise = () => "#";

  test("settles the text from the left as progress grows", () => {
    expect(scrambleFrame("WELL?", 0, noise)).toBe("#####");
    expect(scrambleFrame("WELL?", 0.4, noise)).toBe("WE###");
    expect(scrambleFrame("WELL?", 1, noise)).toBe("WELL?");
  });

  test("keeps spaces, so words keep their shape while they decode", () => {
    expect(scrambleFrame("LIGHTS OUT", 0.2, noise)).toBe("LI#### ###");
  });

  test("clamps progress outside 0..1", () => {
    expect(scrambleFrame("ENTER", -1, noise)).toBe("#####");
    expect(scrambleFrame("ENTER", 3, noise)).toBe("ENTER");
  });

  test("is as long as the text at every step, so no slot is ever empty", () => {
    for (let step = 0; step <= 10; step++) {
      expect(scrambleFrame("ENTER", step / 10)).toHaveLength(5);
    }
  });
});
