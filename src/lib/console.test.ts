import { describe, expect, test } from "vite-plus/test";

import { vibeReply } from "#/lib/console";
import { copy } from "#/lib/copy";
import { DEFAULT_PREFS } from "#/lib/prefs";

const FOUND_ALL = { ...DEFAULT_PREFS, found: ["moth", "switch", "battery"] };

describe("vibeReply", () => {
  test("a vibe is found however it is typed", () => {
    expect(vibeReply(" Sodium ", DEFAULT_PREFS)).toEqual({
      id: "sodium",
      reply: copy.eggs.console.vibe("sodium"),
    });
  });

  test("cryo stays locked until the three things are found", () => {
    expect(vibeReply("cryo", DEFAULT_PREFS)).toEqual({ reply: copy.eggs.console.locked });
    expect(vibeReply("cryo", FOUND_ALL).id).toBe("cryo");
  });

  test("an unknown name lists only the lights the reader has", () => {
    expect(vibeReply("neon", DEFAULT_PREFS)).toEqual({
      reply: copy.eggs.console.unknownVibe("ultraviolet, phosphor, sodium"),
    });
    expect(vibeReply(undefined, FOUND_ALL).reply).toBe(
      copy.eggs.console.unknownVibe("ultraviolet, phosphor, sodium, cryo"),
    );
  });
});
