/**
 * Keyboard shortcuts. One `keydown` listener on `window` serves every key.
 *
 * - A key typed into an input, a textarea, a select or editable text is
 *   skipped, unless the hotkey sets `allowInInput`.
 * - Without `when`, a hotkey runs only while no modal overlay is open. A
 *   hotkey that must work inside an overlay (or open one over another) says
 *   so with its own `when`.
 * - Enter and Space on a focused control (a button, a link, a radio) belong to
 *   that control. They are skipped too, unless the hotkey sets `allowInInput`.
 * - A letter, a digit or a bracket is also matched by its physical key when
 *   the layout types a non-Latin character there: "l" works on a Cyrillic
 *   layout, and so does "]" (the key types "ї" on a Ukrainian one).
 * - When two hotkeys share a key, the one registered last is asked first.
 * - A hotkey that runs takes the key: `preventDefault` is called for it.
 *
 * This module must stay free of content imports: the Enter page uses it.
 */

import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";

import { getUi } from "#/lib/ui";

export interface Hotkey {
  /** "mod+k" (cmd on a Mac, ctrl elsewhere), "/", "l", "?", "shift+enter", "escape", "arrowup", "1" ... */
  keys: string;
  /** What the key does, for the key map. */
  label: string;
  group: "find" | "light" | "read" | "page";
  run: (event: KeyboardEvent) => void;
  /** The hotkey runs only while this returns `true`. Default: no overlay is open. */
  when?: () => boolean;
  allowInInput?: boolean;
  /** Left out of the key map. */
  hidden?: boolean;
}

interface Combo {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

/** The keys of the tools. Their owners register them; the dock, the sheet and the commands show them. */
export const TOOL_KEYS = {
  search: "mod+k",
  ruler: "l",
  torch: "f",
  lightsOut: "b",
  keys: "?",
  sectionNext: "]",
  sectionPrevious: "[",
  top: "t",
} as const;

const NO_HOTKEYS: Hotkey[] = [];

/** Every registered list, oldest first. */
let registry: Hotkey[][] = [];
/** The visible hotkeys of `registry`, flat. Rebuilt when the registry changes. */
let visible: Hotkey[] = NO_HOTKEYS;
const listeners = new Set<() => void>();
const parsed = new Map<string, Combo>();

function isMac(): boolean {
  return typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.platform);
}

function parse(keys: string): Combo {
  const known = parsed.get(keys);
  if (known) return known;

  const combo: Combo = { key: "", mod: false, shift: false, alt: false };
  for (const part of keys.split("+")) {
    const name = part.trim().toLowerCase();
    if (name === "mod") combo.mod = true;
    else if (name === "shift") combo.shift = true;
    else if (name === "alt") combo.alt = true;
    else if (name) combo.key = name === "esc" ? "escape" : name === "space" ? " " : name;
  }
  // "+" and "mod++": the plus key itself was eaten by the split.
  if (!combo.key && keys.endsWith("+")) combo.key = "+";
  parsed.set(keys, combo);
  return combo;
}

/** What `matches` reads of a `keydown`. */
type KeyPress = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">;

/** Physical keys that carry a symbol on a US layout and a letter on others. */
const SYMBOL_CODES: ReadonlyMap<string, string> = new Map([
  ["BracketLeft", "["],
  ["BracketRight", "]"],
]);

/**
 * The Latin letter, the digit or the bracket of the physical key, when the
 * layout types a non-Latin character with it ("д" on the L key, "х" on the
 * [ key). A Latin layout is never second-guessed: on Dvorak the typed letter
 * counts, not the position.
 */
function physicalKey(event: KeyPress): string | undefined {
  if (event.key.length !== 1 || event.key.charCodeAt(0) <= 127) return undefined;
  const symbol = SYMBOL_CODES.get(event.code ?? "");
  if (symbol) return symbol;
  const code = /^(?:Key([A-Z])|Digit(\d))$/.exec(event.code ?? "");
  return code ? (code[1] ?? code[2]).toLowerCase() : undefined;
}

function matches(combo: Combo, event: KeyPress): boolean {
  if (event.key.toLowerCase() !== combo.key && physicalKey(event) !== combo.key) return false;

  const mac = isMac();
  const mod = mac ? event.metaKey : event.ctrlKey;
  const otherMod = mac ? event.ctrlKey : event.metaKey;
  if (mod !== combo.mod || otherMod || event.altKey !== combo.alt) return false;

  // A symbol such as "?" needs Shift on most layouts: Shift is then part of
  // typing the key, not of the shortcut.
  const isSymbol = combo.key.length === 1 && !/[\p{L}\p{N} ]/u.test(combo.key);
  return combo.shift ? event.shiftKey : isSymbol || !event.shiftKey;
}

/** Whether a `keydown` is the shortcut `keys` ("]", "mod+k" ...), on any layout. */
export function isShortcut(keys: string, event: KeyPress): boolean {
  return matches(parse(keys), event);
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

/** Enter activates these; Space activates all of them but a link. */
const ENTER_CONTROLS =
  "button, a[href], summary, [role='button'], [role='link'], [role='radio'], [role='checkbox'], [role='switch'], [role='tab'], [role='menuitem'], [role='option']";

/** The key is about to activate the focused control: it is the control's key. */
function isActivating(event: KeyboardEvent): boolean {
  const enter = event.key === "Enter";
  if (!enter && event.key !== " ") return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (!(event.target instanceof Element)) return false;
  const control = event.target.closest(ENTER_CONTROLS);
  return control !== null && (enter || !control.matches("a[href], [role='link']"));
}

function onKeyDown(event: KeyboardEvent) {
  // Autofill sends a `keydown` without a key.
  if (typeof event.key !== "string" || event.defaultPrevented || event.isComposing) return;
  const reserved = isTyping(event.target) || isActivating(event);

  for (let list = registry.length - 1; list >= 0; list--) {
    for (const hotkey of registry[list]) {
      if (reserved && !hotkey.allowInInput) continue;
      if (!isShortcut(hotkey.keys, event)) continue;
      if (hotkey.when ? !hotkey.when() : getUi().overlay !== null) continue;
      event.preventDefault();
      hotkey.run(event);
      return;
    }
  }
}

function changed() {
  visible = registry.flat().filter((hotkey) => !hotkey.hidden);
  for (const listener of listeners) listener();
}

/** Registers the hotkeys. The returned function removes them again. */
function registerHotkeys(list: Hotkey[]): () => void {
  if (typeof window === "undefined") return () => {};
  if (registry.length === 0) window.addEventListener("keydown", onKeyDown);
  registry = [...registry, list];
  changed();

  return () => {
    const before = registry.length;
    registry = registry.filter((entry) => entry !== list);
    if (registry.length === before) return;
    if (registry.length === 0) window.removeEventListener("keydown", onKeyDown);
    changed();
  };
}

/** What the key map shows of a list: it is registered again only when this changes. */
function signatureOf(list: readonly Hotkey[]): string {
  return list
    .map(({ keys, label, group, hidden, allowInInput }) =>
      [keys, label, group, hidden ? 1 : 0, allowInInput ? 1 : 0].join("\u0000"),
    )
    .join("\n");
}

/**
 * Registers the hotkeys while the component is mounted. `run` and `when`
 * always come from the last render, so they can read props and state
 * directly. The list is registered again only when its keys or labels change.
 */
export function useHotkeys(list: Hotkey[]): void {
  const latest = useRef(list);
  useLayoutEffect(() => {
    latest.current = list;
  });

  const signature = signatureOf(list);
  useEffect(() => {
    const registered = latest.current.map((hotkey, index): Hotkey => ({
      ...hotkey,
      run: (event) => latest.current[index]?.run(event),
      when: hotkey.when && (() => latest.current[index]?.when?.() ?? false),
    }));
    return registerHotkeys(registered);
  }, [signature]);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Every visible hotkey that is registered now, in the order of registration. For the key map. */
export function useHotkeyList(): Hotkey[] {
  return useSyncExternalStore(
    subscribe,
    () => visible,
    () => NO_HOTKEYS,
  );
}

const KEY_NAMES: Record<string, string> = {
  shift: "⇧",
  enter: "↵",
  escape: "esc",
  esc: "esc",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  backspace: "⌫",
  tab: "tab",
  space: "space",
  " ": "space",
};

/** The keycaps of a shortcut: "mod+k" is ["⌘", "K"] on a Mac and ["ctrl", "K"] elsewhere. */
export function formatKeys(keys: string): string[] {
  const { key, mod, shift, alt } = parse(keys);
  const mac = isMac();
  const caps: string[] = [];
  if (mod) caps.push(mac ? "⌘" : "ctrl");
  if (alt) caps.push(mac ? "⌥" : "alt");
  if (shift) caps.push("⇧");
  caps.push(KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return caps;
}
