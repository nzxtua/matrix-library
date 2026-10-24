import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

import { copy } from "#/lib/copy";
import { TOOL_KEYS, formatKeys, isShortcut, useHotkeyList, useHotkeys } from "#/lib/hotkeys";
import type { Hotkey } from "#/lib/hotkeys";
import { closeOverlay, getUi, toggleOverlay } from "#/lib/ui";
import { useOverlayDialog } from "#/lib/use-overlay-dialog";

/** A pressed key stays lit in the key map this long. */
const LIT_MS = 700;

/** A cap that is a sign, not a letter. The mono font draws these too small. */
const SYMBOL = /^[⌘⌥⇧↵⌫↑↓←→]$/;

const GROUP_ORDER: readonly Hotkey["group"][] = ["find", "light", "read", "page"];

export function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function IconClose() {
  return (
    <Icon>
      <path d="m5.5 5.5 9 9m0-9-9 9" />
    </Icon>
  );
}

/** A shortcut as keycaps: "mod+k" is ⌘ K on a Mac. Decoration: the control says its key itself. */
export function Keycaps({ keys, className }: { keys: string; className?: string }) {
  return (
    <span className={className ? `keycaps ${className}` : "keycaps"} aria-hidden="true">
      {formatKeys(keys).map((cap) => (
        <kbd key={cap} className="keycap" data-symbol={SYMBOL.test(cap) || undefined}>
          {cap}
        </kbd>
      ))}
    </span>
  );
}

export interface KeyRow {
  label: string;
  /** Every shortcut that does this, in the order of registration. */
  keys: string[];
}

export interface KeyGroup {
  group: Hotkey["group"];
  rows: KeyRow[];
}

/**
 * The hotkeys as the key map shows them: by group, in a fixed order of
 * groups. Two shortcuts for one thing ("mod+k" and "/") are one row. A
 * shortcut that is registered twice shows once. A group without keys is
 * left out.
 */
export function groupHotkeys(
  list: readonly Pick<Hotkey, "keys" | "label" | "group">[],
): KeyGroup[] {
  const groups: KeyGroup[] = [];
  for (const group of GROUP_ORDER) {
    const rows: KeyRow[] = [];
    for (const hotkey of list) {
      if (hotkey.group !== group) continue;
      const row = rows.find((known) => known.label === hotkey.label);
      if (!row) rows.push({ label: hotkey.label, keys: [hotkey.keys] });
      else if (!row.keys.includes(hotkey.keys)) row.keys.push(hotkey.keys);
    }
    if (rows.length > 0) groups.push({ group, rows });
  }
  return groups;
}

function capsOf(keys: string): string {
  return formatKeys(keys).join(" ");
}

/** The keycaps a `keydown` stands for: with Shift as a key, and as a part of typing a symbol. */
function pressedCaps(event: ReactKeyboardEvent): string[] {
  if (["Shift", "Meta", "Control", "Alt", "Dead", "Unidentified"].includes(event.key)) return [];
  const mac = formatKeys("mod+a")[0] === "⌘";
  const key = event.key === " " ? "space" : event.key.toLowerCase();
  const base = `${(mac ? event.metaKey : event.ctrlKey) ? "mod+" : ""}${event.altKey ? "alt+" : ""}`;
  return [capsOf(`${base}${event.shiftKey ? "shift+" : ""}${key}`), capsOf(`${base}${key}`)];
}

/**
 * The key map (`?`): every hotkey that is registered now, by group, as
 * keycaps. It cannot drift from the real bindings: it reads them.
 * A key pressed while the map is open lights its row, and does nothing else.
 */
export function Keymap() {
  const { open, dialogProps } = useOverlayDialog("keymap");
  const hotkeys = useHotkeyList();
  const titleId = useId();
  const [lit, setLit] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useHotkeys([
    {
      keys: TOOL_KEYS.keys,
      label: copy.labels.keys,
      group: "page",
      run: () => toggleOverlay("keymap"),
      // The same key closes the map again.
      when: () => getUi().overlay === null || getUi().overlay === "keymap",
    },
  ]);

  useEffect(() => {
    if (lit.length === 0) return;
    const timer = window.setTimeout(() => setLit([]), LIT_MS);
    return () => window.clearTimeout(timer);
  }, [lit]);

  // The focus goes to the list, not to the close button: the list scrolls
  // with the arrow keys, and Escape closes from anywhere.
  useLayoutEffect(() => {
    if (open) listRef.current?.focus({ preventScroll: true });
  }, [open]);

  const groups = open ? groupHotkeys(hotkeys) : [];

  return (
    <dialog
      {...dialogProps}
      className="keymap"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        // The real matcher first: it knows the physical-key fallback of other
        // layouts ("х" is "["). Then the keycaps of what was typed.
        const bound = hotkeys
          .filter((hotkey) => isShortcut(hotkey.keys, event.nativeEvent))
          .map((hotkey) => capsOf(hotkey.keys));
        const caps = bound.length > 0 ? bound : pressedCaps(event);
        if (caps.length > 0) setLit(caps);
      }}
    >
      <div className="keymap__body">
        <header className="keymap__head">
          <h2 id={titleId} className="keymap__title">
            {copy.keys.title}
          </h2>
          <button
            type="button"
            className="dialog-close"
            aria-label={copy.labels.close}
            onClick={closeOverlay}
          >
            <IconClose />
          </button>
        </header>

        <div ref={listRef} className="keymap__list" tabIndex={-1}>
          <div className="keymap__groups">
            {groups.map(({ group, rows }) => (
              <section key={group} className="keymap__group">
                <h3 className="keymap__group-name">{copy.labels.hotkeyGroups[group]}</h3>
                <dl className="keymap__rows">
                  {rows.map((row) => (
                    <div
                      key={row.label}
                      className="keymap__row"
                      data-lit={row.keys.some((keys) => lit.includes(capsOf(keys))) || undefined}
                    >
                      <dt>{row.label}</dt>
                      <dd>
                        {row.keys.map((keys) => (
                          <span key={keys} className="keymap__keys">
                            <span className="sr-only">{formatKeys(keys).join(" ")}</span>
                            <Keycaps keys={keys} />
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </div>
      </div>
    </dialog>
  );
}
