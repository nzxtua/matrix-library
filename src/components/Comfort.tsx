import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { copy } from "#/lib/copy";
import { ping } from "#/lib/jump";
import { MOTIONS, SIZES, clearPrefs, setPrefs, usePrefs } from "#/lib/prefs";
import type { VibeId } from "#/lib/prefs";
import { toast } from "#/lib/toast";
import { FOUND_TOTAL, VIBES, isUnlocked, setVibe, vibeById } from "#/lib/vibes";

/** A pointer press counts as the origin of the next change for this long. */
const PRESS_MS = 1000;
/** How long the line under the lamps says how a locked lamp opens. */
const ASKED_MS = 5000;
/** A question nobody answers is taken back after this long. */
const ARMED_MS = 8000;

/**
 * The four lights. Every lamp shows its own colour, so the reader sees a
 * light before choosing it. The line under them names the lamp under the
 * pointer or the focus, and says how a locked one opens.
 */
function Lights() {
  const group = useId();
  const noteRef = useRef<HTMLParagraphElement>(null);
  /** Where the pointer went down, in viewport pixels: the new light spreads from there. */
  const press = useRef<{ x: number; y: number; at: number } | null>(null);

  const vibe = usePrefs((prefs) => prefs.vibe);
  const unlocked = usePrefs((prefs) => VIBES.map((item) => isUnlocked(item.id, prefs)));
  const found = usePrefs((prefs) => Math.min(FOUND_TOTAL, new Set(prefs.found).size));

  /** The lamp under the pointer or the focus. */
  const [peek, setPeek] = useState<VibeId | null>(null);
  /** The locked lamp the reader asked for. Its answer stays until another choice. */
  const [asked, setAsked] = useState<{ id: VibeId; at: number } | null>(null);

  // The answer stays long enough to read, then the line names the lamp that is on again.
  useEffect(() => {
    if (!asked) return;
    const timer = window.setTimeout(() => setAsked(null), ASKED_MS);
    return () => window.clearTimeout(timer);
  }, [asked]);

  const choose = (id: VibeId, open: boolean, input: HTMLInputElement) => {
    if (!open) {
      // A new object every time: a second ask starts the wait again.
      setAsked({ id, at: performance.now() });
      if (noteRef.current) ping(noteRef.current);
      return;
    }
    setAsked(null);

    // From the click point; from the lamp itself when the keyboard chose.
    const pressed = press.current;
    press.current = null;
    let origin: { x: number; y: number };
    if (pressed && performance.now() - pressed.at < PRESS_MS) {
      origin = { x: pressed.x, y: pressed.y };
    } else {
      const lamp = input.parentElement?.querySelector(".lamp__dot") ?? input;
      const box = lamp.getBoundingClientRect();
      origin = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    setVibe(id, origin);
  };

  const shown = vibeById(peek ?? asked?.id ?? vibe);
  const shownOpen = unlocked[VIBES.indexOf(shown)];

  return (
    <div className="comfort__light">
      <span className="comfort__label" id={`${group}-label`}>
        {copy.comfort.light}
      </span>

      <div className="lamps" role="radiogroup" aria-labelledby={`${group}-label`}>
        {VIBES.map((item, index) => {
          const open = unlocked[index];
          return (
            <label
              key={item.id}
              className="lamp"
              data-locked={open ? undefined : ""}
              style={{ "--swatch": item.swatch } as CSSProperties}
              onPointerDown={(event) => {
                press.current = { x: event.clientX, y: event.clientY, at: performance.now() };
              }}
              onPointerEnter={(event) => {
                // A touch has no hover: it would only flash the line.
                if (event.pointerType === "mouse") setPeek(item.id);
              }}
              onPointerLeave={() => setPeek((id) => (id === item.id ? null : id))}
            >
              <input
                className="sr-only"
                type="radio"
                name={group}
                value={item.id}
                checked={item.id === vibe}
                aria-disabled={open ? undefined : true}
                onChange={(event) => choose(item.id, open, event.currentTarget)}
                onClick={(event) => {
                  // A locked lamp never takes the mark, also not for a frame.
                  if (!open) {
                    event.preventDefault();
                    choose(item.id, open, event.currentTarget);
                  }
                }}
                onFocus={(event) => {
                  if (event.currentTarget.matches(":focus-visible")) setPeek(item.id);
                }}
                onBlur={() => setPeek((id) => (id === item.id ? null : id))}
              />
              <span className="lamp__dot" aria-hidden="true" />
              <span className="lamp__name">{item.label}</span>
              {!open && <span className="lamp__count">{copy.enter.found(found)}</span>}
              <span className="sr-only">
                {open ? item.note : `${copy.labels.locked}. ${copy.comfort.locked}`}
              </span>
            </label>
          );
        })}
      </div>

      {/* The lamps carry their own names for a screen reader: this line is for the eye. */}
      <p ref={noteRef} className="comfort__note" aria-hidden="true">
        <span className="comfort__note-name">{shown.label}</span>
        <span>{shownOpen ? shown.note : copy.comfort.locked}</span>
        {!shownOpen && <span className="comfort__note-count">{copy.enter.found(found)}</span>}
      </p>
    </div>
  );
}

interface Option<T extends string> {
  value: T;
  /** What the segment shows. */
  text: ReactNode;
  /** The full name, when the text is a short form. */
  name?: string;
}

interface SegmentsProps<T extends string> {
  label: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}

/** One row: a label and a few choices, with a thumb on the chosen one. */
function Segments<T extends string>({ label, options, value, onChange }: SegmentsProps<T>) {
  const group = useId();
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  return (
    <div className="comfort__row">
      <span className="comfort__label" id={`${group}-label`}>
        {label}
      </span>
      <div
        className="segments"
        role="radiogroup"
        aria-labelledby={`${group}-label`}
        style={{ "--count": options.length, "--index": index } as CSSProperties}
      >
        <span className="segments__thumb" aria-hidden="true" />
        {options.map((option) => (
          <label key={option.value} className="segments__option">
            <input
              className="sr-only"
              type="radio"
              name={group}
              value={option.value}
              checked={option.value === value}
              aria-label={option.name}
              onChange={() => onChange(option.value)}
            />
            <span>{option.text}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** "Clear my data", in two steps: the question, then the answer. */
function Clear() {
  const [armed, setArmed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  /** The focus was on a button that is gone now: it moves to the one that took its place. */
  const moveFocus = useRef(false);

  useEffect(() => {
    if (moveFocus.current) {
      moveFocus.current = false;
      // The safe answer gets the focus: a second Enter keeps the data.
      (armed ? keepRef : triggerRef).current?.focus({ preventScroll: true });
    }
    if (!armed) return;
    const timer = window.setTimeout(() => {
      moveFocus.current = keepRef.current?.parentElement?.contains(document.activeElement) ?? false;
      setArmed(false);
    }, ARMED_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  const answer = (clear: boolean) => {
    moveFocus.current = true;
    setArmed(false);
    if (!clear) return;
    clearPrefs();
    toast(copy.comfort.cleared);
  };

  if (!armed) {
    return (
      <div className="comfort__clear">
        <button
          ref={triggerRef}
          type="button"
          className="comfort__clear-ask"
          onClick={() => {
            moveFocus.current = true;
            setArmed(true);
          }}
        >
          {copy.comfort.clear}
        </button>
      </div>
    );
  }

  return (
    <div
      className="comfort__clear"
      role="group"
      aria-label={copy.comfort.clear}
      data-armed=""
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // The question is closed, and nothing behind it.
        event.preventDefault();
        event.stopPropagation();
        answer(false);
      }}
    >
      <span className="comfort__clear-text">{copy.comfort.clearAsk}</span>
      <button ref={keepRef} type="button" className="comfort__answer" onClick={() => answer(false)}>
        {copy.comfort.clearNo}
      </button>
      <button
        type="button"
        className="comfort__answer"
        data-clear=""
        aria-label={copy.comfort.clear}
        onClick={() => answer(true)}
      >
        {copy.comfort.clearYes}
      </button>
    </div>
  );
}

/**
 * How the page looks and moves, and the way out: the light, the text size,
 * the motion, and "clear my data". The footer of the panel; also in the
 * sheet. It needs no parent of its own: it lays itself out by its own width.
 */
export function Comfort() {
  const size = usePrefs((prefs) => prefs.size);
  const motion = usePrefs((prefs) => prefs.motion);

  return (
    <div className="comfort">
      <Lights />
      <Segments
        label={copy.comfort.text}
        value={size}
        options={SIZES.map((value) => ({
          value,
          text: value.toUpperCase(),
          name: copy.labels.sizes[value],
        }))}
        onChange={(value) => setPrefs({ size: value })}
      />
      <Segments
        label={copy.comfort.motion}
        value={motion}
        options={MOTIONS.map((value) => ({ value, text: copy.labels.motions[value] }))}
        onChange={(value) => setPrefs({ motion: value })}
      />
      <Clear />
    </div>
  );
}
