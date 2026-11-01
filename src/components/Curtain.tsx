import { Fragment, useEffect, useRef } from "react";

import { Moth } from "#/components/Moth";
import type { MothHandle } from "#/components/Moth";
import { copy } from "#/lib/copy";
import { TOOL_KEYS, useHotkeys } from "#/lib/hotkeys";
import { beamFalloff, createFlashlight } from "#/lib/matrix-flashlight";
import type { Flashlight, Light } from "#/lib/matrix-flashlight";
import { getPrefs, usePrefs } from "#/lib/prefs";
import { prefersReducedMotion } from "#/lib/reduced-motion";
import { closeOverlay, getUi, toggleOverlay, useUi } from "#/lib/ui";
import { useVibe, vibeById } from "#/lib/vibes";

/** The key or the click that opened the curtain must not close it again. */
const GUARD_MS = 320;
/** Out of the beam the text is dark at first. Later a little of it stays, so the way back can be found. */
const FLOOR = 0.24;
const FLOOR_AFTER_MS = 1600;
const FLOOR_RISE_MS = 900;

/** Keys that are part of another shortcut (switching windows): the lights stay out. */
const MODIFIER_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "OS",
  "CapsLock",
  "Fn",
  "Dead",
  "Unidentified",
]);

/** The text, sentence by sentence: a narrow screen breaks the line between two sentences. */
const SENTENCES = copy.curtain.text.split(/(?<=[.!?])\s+/).map((sentence) => Array.from(sentence));

/**
 * Lights out: one key and the document is gone.
 *
 * A native modal `<dialog>`: the page behind it is inert and the layer sits
 * above everything. It is black at once, with no fade: it is there for the
 * moment somebody walks up. In the dark, the Enter page's flashlight, and one
 * line of text that only the beam shows, letter by letter. The tab title is
 * swapped too. Any key or click brings the page back where it was.
 *
 * With reduced motion: plain black and the text.
 */
export function Curtain() {
  const open = useUi((state) => state.overlay === "curtain");
  const vibe = useVibe();

  const dialogRef = useRef<HTMLDialogElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const flashlightRef = useRef<Flashlight | null>(null);
  const mothRef = useRef<MothHandle>(null);
  /** The moth found on the Enter page lives in the light, here too. */
  const hasMoth = usePrefs((prefs) => prefs.found.includes("moth"));

  // `open` is never true on the server, so this reads the browser only.
  const plain = open && prefersReducedMotion();

  useHotkeys([
    {
      keys: TOOL_KEYS.lightsOut,
      label: copy.labels.lightsOut,
      group: "light",
      // The same key closes it. Another open overlay keeps the key.
      when: () => getUi().overlay === null || getUi().overlay === "curtain",
      run: () => toggleOverlay("curtain"),
    },
  ]);

  // The dialog, the title, and the way back.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    if (!dialog.open) dialog.showModal();
    const title = window.document.title;
    window.document.title = copy.curtain.title;
    const openedAt = performance.now();

    const back = () => {
      if (performance.now() - openedAt >= GUARD_MS) closeOverlay();
    };

    const onKey = (event: KeyboardEvent) => {
      // Cmd+Tab and the like belong to the system. They must not show the page.
      if (event.metaKey || event.ctrlKey || event.altKey || MODIFIER_KEYS.has(event.key)) return;
      // The key is spent here: no hotkey, no scrolling of the page behind.
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) back();
    };
    const onCancel = (event: Event) => {
      event.preventDefault();
      back();
    };
    const onClose = () => {
      // Closed by something else than this component.
      if (getUi().overlay === "curtain") closeOverlay();
    };
    const still = (event: Event) => event.preventDefault();

    window.addEventListener("keydown", onKey, { capture: true });
    dialog.addEventListener("click", back);
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);
    // The page behind the curtain keeps its place.
    dialog.addEventListener("wheel", still, { passive: false });
    dialog.addEventListener("touchmove", still, { passive: false });

    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      dialog.removeEventListener("click", back);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
      dialog.removeEventListener("wheel", still);
      dialog.removeEventListener("touchmove", still);
      if (window.document.title === copy.curtain.title) window.document.title = title;
      if (dialog.open) dialog.close();
    };
  }, [open]);

  // The flashlight, and the text it finds.
  useEffect(() => {
    const canvas = canvasRef.current;
    const text = textRef.current;
    if (!open || plain || !canvas || !text) return;

    const letters = [...text.querySelectorAll<HTMLElement>("[data-letter]")];
    let spots: { x: number; y: number }[] = [];
    let plate = text.getBoundingClientRect();
    const measure = () => {
      plate = text.getBoundingClientRect();
      spots = letters.map((letter) => {
        const box = letter.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      });
    };
    measure();

    const shown = letters.map(() => -1);
    let edgeShown = "";
    const startedAt = performance.now();

    const onLight = ({ x, y, radius, power }: Light) => {
      const waited = performance.now() - startedAt - FLOOR_AFTER_MS;
      const floor = FLOOR * Math.min(1, Math.max(0, waited / FLOOR_RISE_MS));

      // The edge of the plate shows only where the beam falls on it: the
      // beam, as the plate sees it, masks the edge (`styles/tools.css`).
      const edge = `${Math.round(x - plate.left)}px ${Math.round(y - plate.top)}px ${Math.round(radius)}px ${power.toFixed(2)}`;
      if (edge !== edgeShown) {
        edgeShown = edge;
        text.style.setProperty("--beam-x", `${Math.round(x - plate.left)}px`);
        text.style.setProperty("--beam-y", `${Math.round(y - plate.top)}px`);
        text.style.setProperty("--beam-r", `${Math.round(radius)}px`);
        text.style.setProperty("--beam", power.toFixed(2));
      }

      for (let index = 0; index < letters.length; index++) {
        const spot = spots[index];
        const lit = power * beamFalloff(Math.hypot(spot.x - x, spot.y - y), radius);
        const value = Math.max(floor, lit);
        if (Math.abs(value - shown[index]) < 0.01) continue;
        shown[index] = value;
        letters[index].style.opacity = value.toFixed(2);
      }

      mothRef.current?.update({ x, y, radius, power, pace: 1 });
    };

    const flashlight = createFlashlight(canvas, {
      palette: vibeById(getPrefs().vibe).rain,
      sweep: true,
      onLight,
    });
    flashlightRef.current = flashlight;

    // The first thing the beam finds is the text.
    flashlight.aim(plate.left + plate.width / 2, plate.top + plate.height / 2);

    const observer = new ResizeObserver(measure);
    observer.observe(text);
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      flashlight.destroy();
      flashlightRef.current = null;
    };
  }, [open, plain]);

  // The reader's light, whatever it was when the curtain fell.
  useEffect(() => {
    flashlightRef.current?.setPalette(vibe.rain);
  }, [vibe]);

  return (
    <dialog
      ref={dialogRef}
      className="curtain"
      aria-label={copy.labels.lightsOut}
      data-beam={(open && !plain) || undefined}
    >
      {open && (
        <>
          {!plain && <canvas ref={canvasRef} className="curtain__rain" aria-hidden="true" />}
          {!plain && hasMoth && <Moth ref={mothRef} />}
          <p ref={textRef} className="curtain__text">
            <span className="sr-only">{copy.curtain.text}</span>
            <span aria-hidden="true">
              {SENTENCES.map((letters, sentence) => (
                <Fragment key={sentence}>
                  {sentence > 0 && " "}
                  <span className="curtain__sentence">
                    {letters.map((letter, index) => (
                      <span key={index} data-letter>
                        {letter}
                      </span>
                    ))}
                  </span>
                </Fragment>
              ))}
            </span>
          </p>
        </>
      )}
    </dialog>
  );
}
