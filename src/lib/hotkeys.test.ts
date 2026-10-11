import { describe, expect, test } from "vite-plus/test";

import { isShortcut } from "#/lib/hotkeys";

function press(key: string, code: string, modifiers: { shiftKey?: boolean } = {}) {
  return {
    key,
    code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  };
}

describe("isShortcut", () => {
  test("on a Ukrainian layout the bracket keys still hop sections", () => {
    expect(isShortcut("[", press("х", "BracketLeft"))).toBe(true);
    expect(isShortcut("]", press("ї", "BracketRight"))).toBe(true);
    expect(isShortcut("]", press("Ї", "BracketRight", { shiftKey: true }))).toBe(true);
  });

  test("a Cyrillic letter counts as the Latin key under it, not as a look-alike", () => {
    // The T key types the Cyrillic "е" on a Ukrainian layout: it is "t", never echo's "e".
    expect(isShortcut("t", press("е", "KeyT"))).toBe(true);
    expect(isShortcut("e", press("е", "KeyT"))).toBe(false);
    expect(isShortcut("e", press("у", "KeyE"))).toBe(true);
  });

  test("a Latin layout is taken at its word, symbols included", () => {
    // Dvorak: the B position types "x".
    expect(isShortcut("b", press("x", "KeyB"))).toBe(false);
    // US: Shift and [ type "{", which is not "[".
    expect(isShortcut("[", press("{", "BracketLeft", { shiftKey: true }))).toBe(false);
  });

  test("a symbol that needs Shift to be typed still matches", () => {
    expect(isShortcut("+", press("+", "Equal", { shiftKey: true }))).toBe(true);
    expect(isShortcut("=", press("=", "Equal"))).toBe(true);
    expect(isShortcut("-", press("-", "Minus"))).toBe(true);
  });

  test("a letter with Shift is another shortcut", () => {
    expect(isShortcut("f", press("F", "KeyF", { shiftKey: true }))).toBe(false);
    expect(isShortcut("f", press("f", "KeyF"))).toBe(true);
  });
});
