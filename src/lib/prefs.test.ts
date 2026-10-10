import { afterEach, describe, expect, test, vi } from "vite-plus/test";

const KEY = "mf:v1";

/** A `localStorage` that holds `stored` under the key, or throws on every call. */
function fakeStorage(stored: string | null, broken = false) {
  const items = new Map<string, string>();
  if (stored !== null) items.set(KEY, stored);
  const guard = () => {
    if (broken) throw new DOMException("denied", "SecurityError");
  };
  return {
    items,
    getItem(key: string) {
      guard();
      return items.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      guard();
      items.set(key, value);
    },
    removeItem(key: string) {
      guard();
      items.delete(key);
    },
  };
}

/** Loads a fresh copy of the module in a browser that has `storage`. */
async function loadPrefs(storage: ReturnType<typeof fakeStorage>) {
  vi.resetModules();
  vi.stubGlobal("window", { localStorage: storage, addEventListener() {} });
  return import("#/lib/prefs");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stored preferences", () => {
  test.each([
    ["broken JSON", '{"vibe":"sodium"'],
    ["an array", "[1,2,3]"],
    ["null", "null"],
    ["a string", '"ultraviolet"'],
    ["a number", "42"],
    ["an empty string", ""],
  ])("fall back to the defaults for %s", async (_name, stored) => {
    const { getPrefs, DEFAULT_PREFS } = await loadPrefs(fakeStorage(stored));

    expect(getPrefs()).toEqual(DEFAULT_PREFS);
  });

  test("keep the valid fields of a foreign object and drop the rest", async () => {
    const foreign = {
      vibe: "sodium",
      size: "xl",
      motion: 1,
      seen: "yes",
      found: ["moth", 7, null, "moth", ""],
      read: "all of it",
      last: { id: "b-1" },
      percent: 250,
      hashes: { intro: "abc", broken: 3 },
      theme: "light",
    };
    const { getPrefs } = await loadPrefs(fakeStorage(JSON.stringify(foreign)));

    expect(getPrefs()).toEqual({
      vibe: "sodium",
      size: "m",
      motion: "full",
      seen: false,
      found: ["moth"],
      doc: null,
      shelf: {},
      read: [],
      last: null,
      percent: 100,
      hashes: { intro: "abc" },
    });
  });

  test("can be written after a corrupt value was read", async () => {
    const storage = fakeStorage("{{{{");
    const { getPrefs, setPrefs } = await loadPrefs(storage);

    setPrefs({ vibe: "phosphor", read: ["b-1"] });
    setPrefs((prefs) => ({ read: [...prefs.read, "b-2"] }));

    expect(getPrefs()).toMatchObject({ vibe: "phosphor", read: ["b-1", "b-2"] });
    // A second page load reads what the first one wrote.
    const reloaded = await loadPrefs(storage);
    expect(reloaded.getPrefs()).toEqual(getPrefs());
  });

  test("hold for the visit when the browser blocks storage", async () => {
    const { getPrefs, setPrefs, clearPrefs, DEFAULT_PREFS } = await loadPrefs(
      fakeStorage(null, true),
    );

    expect(getPrefs()).toEqual(DEFAULT_PREFS);
    setPrefs({ size: "l", seen: true });
    expect(getPrefs()).toMatchObject({ size: "l", seen: true });
    clearPrefs();
    expect(getPrefs()).toEqual(DEFAULT_PREFS);
  });

  test("never store an invalid value that was passed to setPrefs", async () => {
    const storage = fakeStorage(null);
    const { getPrefs, setPrefs } = await loadPrefs(storage);

    setPrefs({ vibe: "neon" as never, percent: -5, last: "b-9" });

    expect(getPrefs()).toMatchObject({ vibe: "ultraviolet", percent: 0, last: "b-9" });
    expect(JSON.parse(storage.items.get(KEY) ?? "{}")).toEqual(getPrefs());
  });

  test("keep a field that the patch holds as undefined", async () => {
    const { getPrefs, setPrefs } = await loadPrefs(fakeStorage(null));
    setPrefs({ vibe: "sodium", last: "b-abc" });

    setPrefs({ vibe: undefined, last: undefined, size: "l" });

    expect(getPrefs()).toMatchObject({ vibe: "sodium", last: "b-abc", size: "l" });
  });

  test("are gone after clearPrefs, on this load and the next", async () => {
    const storage = fakeStorage(JSON.stringify({ vibe: "sodium", read: ["b-1"], seen: true }));
    const { getPrefs, clearPrefs, DEFAULT_PREFS } = await loadPrefs(storage);
    expect(getPrefs().vibe).toBe("sodium");

    clearPrefs();

    expect(getPrefs()).toEqual(DEFAULT_PREFS);
    expect((await loadPrefs(storage)).getPrefs()).toEqual(DEFAULT_PREFS);
  });

  test("tell a subscriber about a change, and not about a write that changes nothing", async () => {
    const { setPrefs, subscribePrefs } = await loadPrefs(fakeStorage(null));
    const calls = vi.fn();
    subscribePrefs(calls);

    setPrefs({ size: "l" });
    setPrefs({ size: "l" });

    expect(calls).toHaveBeenCalledTimes(1);
  });
});

describe("progress per document", () => {
  test("survives a visit to another document and back", async () => {
    const storage = fakeStorage(null);
    const { getPrefs, openDoc, setProgress, progressOf } = await loadPrefs(storage);

    openDoc("setup");
    setProgress("setup", { read: ["b-1", "b-2"], last: "b-2", percent: 40 });
    openDoc("rollout");

    expect(getPrefs()).toMatchObject({ doc: "rollout", read: [], last: null, percent: 0 });
    expect(progressOf(getPrefs(), "setup")).toMatchObject({ read: ["b-1", "b-2"], percent: 40 });

    openDoc("setup");
    const reloaded = await loadPrefs(storage);
    expect(reloaded.getPrefs()).toMatchObject({ doc: "setup", read: ["b-1", "b-2"], last: "b-2" });
  });

  test("a document that is closing saves its place on the shelf, not in the open one", async () => {
    const { getPrefs, openDoc, setProgress, progressOf } = await loadPrefs(fakeStorage(null));
    openDoc("setup");
    openDoc("rollout");

    setProgress("setup", { last: "b-9" });

    expect(getPrefs().last).toBeNull();
    expect(progressOf(getPrefs(), "setup").last).toBe("b-9");
  });

  test("progress stored before there were several documents goes to the first one opened", async () => {
    const stored = JSON.stringify({ read: ["b-1"], last: "b-1", percent: 12 });
    const { getPrefs, openDoc } = await loadPrefs(fakeStorage(stored));

    openDoc("content");

    expect(getPrefs()).toMatchObject({ doc: "content", read: ["b-1"], percent: 12 });
  });
});
