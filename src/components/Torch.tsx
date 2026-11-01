import { useEffect, useLayoutEffect, useRef } from "react";

import { copy } from "#/lib/copy";
import { TOOL_KEYS, useHotkeys } from "#/lib/hotkeys";
import { prefersReducedMotion } from "#/lib/reduced-motion";
import { toast } from "#/lib/toast";
import { getUi, setTorch, useUi } from "#/lib/ui";

/** The natural radius of the beam: `min(36vh, 280px)`, and never wider than a phone allows. */
const RADIUS_SHARE_OF_HEIGHT = 0.36;
const RADIUS_MAX = 280;
const RADIUS_SHARE_OF_WIDTH = 0.62;
/** The beam can be this much smaller or larger than its natural size, as on the Enter page. */
const MIN_SCALE = 0.6;
const MAX_SCALE = 1.6;
const SCALE_STEP = 0.2;
/** Without a pointer the beam rests on the reading line: this share of the viewport height. */
const REST_SHARE = 0.35;
/** A finger hides what is under it: the beam shines this share of its radius above the finger. */
const TOUCH_LIFT = 0.4;
/** After the finger lifts, the light stays this long, then goes back to the reading line. */
const TOUCH_LINGER_MS = 1200;
/** The pointer takes the beam back from a place it was sent to after moving this far, in px. */
const TAKE_BACK = 6;
/** A beam sent to a place keeps its centre this share of its radius inside the viewport. */
const AIM_MARGIN = 0.55;
/** These stand above the dark: the keyboard focus on them does not move the beam. */
const ABOVE_THE_DARK = ".dock-slot, .echo__card, .searchlight, dialog";

/** The size of the beam for this page load. Not stored. */
let scale = 1;
/** "torch on" is said once per page load. */
let announced = false;

function radiusOf(beamScale: number): number {
  const natural = Math.min(
    window.innerHeight * RADIUS_SHARE_OF_HEIGHT,
    RADIUS_MAX,
    window.innerWidth * RADIUS_SHARE_OF_WIDTH,
  );
  return natural * beamScale;
}

/** The next size of the beam after `+` (1) or `-` (-1), within 0.6..1.6. */
function nextScale(current: number, direction: 1 | -1): number {
  const next = Math.round((current + direction * SCALE_STEP) * 10) / 10;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The middle of the text column on the reading line: where the beam rests. */
function restingPlace(): { x: number; y: number } {
  const doc = window.document.getElementById("doc");
  const prose =
    doc?.querySelector<HTMLElement>(':scope > .doc__block[data-kind="paragraph"]') ?? doc;
  const box = prose?.getBoundingClientRect();
  const x = box && box.width > 0 ? box.left + box.width / 2 : window.innerWidth / 2;
  return { x, y: window.innerHeight * REST_SHARE };
}

function torchIsOn(): boolean {
  return getUi().torch && getUi().overlay === null;
}

/**
 * Reading by torchlight (`f`): the page goes dark and a soft round beam
 * follows the pointer. The Enter page's flashlight, in the document.
 *
 * One layer that never takes a pointer event: clicks, selection and scrolling
 * pass through. It holds two plates, moved with `transform` only:
 * - the dark: near-black, with a hole cut by a radial mask. The core of the
 *   hole (30 % of the radius) is fully lit; the edge falls off smoothly, as
 *   the Enter page beam does;
 * - the haze: the colour of the light, faint, blended as light (`screen`), so
 *   the ink of the text stays neutral.
 *
 * The beam's place is written as custom properties on the layer, once per
 * frame at most. React renders only when the torch goes on or off.
 *
 * The beam follows a mouse or a pen; a dragging finger, shining just above
 * it; the keyboard focus; and the target of every ping (a jump, a hop, a
 * search result). Without a pointer it rests on the reading line. It opens
 * like an iris; with less motion it is simply there.
 */
export function Torch() {
  const on = useUi((state) => state.torch);
  const paused = useUi((state) => state.overlay !== null);
  const layerRef = useRef<HTMLDivElement>(null);
  /** The last mouse or pen position, kept while the torch is off: the beam opens under it. */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /** Set while the torch is on: `+` and `-`. */
  const resizer = useRef<((direction: 1 | -1) => void) | null>(null);

  useHotkeys([
    {
      keys: TOOL_KEYS.torch,
      label: copy.labels.torch,
      group: "light",
      run: () => setTorch(!getUi().torch),
    },
    {
      keys: "+",
      label: copy.labels.torchBigger,
      group: "light",
      when: torchIsOn,
      run: () => resizer.current?.(1),
    },
    {
      keys: "=",
      label: copy.labels.torchBigger,
      group: "light",
      when: torchIsOn,
      run: () => resizer.current?.(1),
    },
    {
      keys: "-",
      label: copy.labels.torchSmaller,
      group: "light",
      when: torchIsOn,
      run: () => resizer.current?.(-1),
    },
  ]);

  // Escape is registered when the torch goes on: the newest list is asked
  // first, so the torch goes before a card that came up earlier. What is lit
  // (echo, searchlight) is cleared first.
  useHotkeys(
    on
      ? [
          {
            keys: "escape",
            label: copy.labels.torch,
            group: "light",
            hidden: true,
            when: () => {
              const ui = getUi();
              return ui.torch && ui.overlay === null && ui.echo === null && ui.searchlight === null;
            },
            run: () => setTorch(false),
          },
        ]
      : [],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "touch") pointer.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // A layout effect: the beam is in place before the first frame of the iris.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!on || !layer) return;

    if (!announced) {
      announced = true;
      // A phone has no `f` key: name the button instead.
      toast(window.matchMedia("(hover: none)").matches ? copy.torch.onTouch : copy.torch.on);
    }

    const beam = {
      x: 0,
      y: 0,
      radius: radiusOf(scale),
      frame: 0,
      /** No pointer holds the beam: it sits on the reading line and follows a resize. */
      resting: false,
      /** Where the pointer was when the beam was sent somewhere else. */
      heldAt: null as { x: number; y: number } | null,
      linger: 0,
    };

    const draw = () => {
      beam.frame = 0;
      layer.style.setProperty("--torch-x", `${beam.x.toFixed(1)}px`);
      layer.style.setProperty("--torch-y", `${beam.y.toFixed(1)}px`);
    };
    const schedule = () => {
      if (beam.frame === 0) beam.frame = requestAnimationFrame(draw);
    };

    /** `glide`: the beam travels to the place instead of jumping (not with less motion). */
    const aim = (x: number, y: number, glide = false) => {
      beam.x = clamp(x, 0, window.innerWidth);
      beam.y = clamp(y, 0, window.innerHeight);
      const gliding = glide && !prefersReducedMotion();
      if (layer.hasAttribute("data-glide") !== gliding)
        layer.toggleAttribute("data-glide", gliding);
      schedule();
    };

    const rest = (glide = false) => {
      const place = restingPlace();
      beam.resting = true;
      aim(place.x, place.y, glide);
    };

    /**
     * Sends the beam to an element: its middle, or its first lines when it is
     * tall or wide. The lit core stays on screen: a heading at the top edge
     * gets the beam a little below it, over the lines that follow.
     */
    const aimAt = (element: Element) => {
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) return;
      beam.resting = false;
      beam.heldAt = pointer.current ? { ...pointer.current } : null;
      const marginX = Math.min(beam.radius * AIM_MARGIN, window.innerWidth / 2);
      const marginY = Math.min(beam.radius * AIM_MARGIN, window.innerHeight / 2);
      aim(
        clamp(
          box.left + Math.min(box.width / 2, beam.radius * 0.85),
          marginX,
          window.innerWidth - marginX,
        ),
        clamp(
          box.top + Math.min(box.height / 2, beam.radius * 0.5),
          marginY,
          window.innerHeight - marginY,
        ),
        true,
      );
    };

    const size = () => {
      beam.radius = radiusOf(scale);
      layer.style.setProperty("--torch-size", `${beam.radius.toFixed(1)}px`);
    };

    resizer.current = (direction) => {
      scale = nextScale(scale, direction);
      size();
    };

    size();
    if (pointer.current) {
      beam.x = pointer.current.x;
      beam.y = pointer.current.y;
    } else {
      const place = restingPlace();
      beam.x = place.x;
      beam.y = place.y;
      beam.resting = true;
    }
    draw();

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      if (beam.heldAt) {
        const moved = Math.hypot(event.clientX - beam.heldAt.x, event.clientY - beam.heldAt.y);
        if (moved < TAKE_BACK) return;
        beam.heldAt = null;
      }
      beam.resting = false;
      aim(event.clientX, event.clientY);
    };

    const onTouch = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      window.clearTimeout(beam.linger);
      beam.resting = false;
      beam.heldAt = null;
      aim(touch.clientX, touch.clientY - beam.radius * TOUCH_LIFT);
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length > 0) return;
      window.clearTimeout(beam.linger);
      beam.linger = window.setTimeout(() => rest(true), TOUCH_LINGER_MS);
    };

    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.closest(ABOVE_THE_DARK)) return;
      if (target.matches(":focus-visible")) aimAt(target);
    };

    const onResize = () => {
      size();
      if (beam.resting) rest();
      else aim(beam.x, beam.y);
    };

    // Every jump ends in a ping: the light goes where the reader was sent.
    const pings = new MutationObserver((records) => {
      for (const record of records) {
        if (record.target instanceof Element && record.target.hasAttribute("data-ping")) {
          aimAt(record.target);
          return;
        }
      }
    });
    const root = window.document.getElementById("doc");
    if (root) {
      pings.observe(root, { subtree: true, attributes: true, attributeFilter: ["data-ping"] });
    }

    const listeners = new AbortController();
    const { signal } = listeners;
    window.addEventListener("pointermove", onPointerMove, { passive: true, signal });
    window.addEventListener("touchstart", onTouch, { passive: true, signal });
    window.addEventListener("touchmove", onTouch, { passive: true, signal });
    window.addEventListener("touchend", onTouchEnd, { passive: true, signal });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true, signal });
    window.addEventListener("resize", onResize, { signal });
    window.document.addEventListener("focusin", onFocus, { signal });

    return () => {
      listeners.abort();
      pings.disconnect();
      cancelAnimationFrame(beam.frame);
      window.clearTimeout(beam.linger);
      resizer.current = null;
      // The place stays: the dark fades out where the beam was.
      layer.removeAttribute("data-glide");
    };
  }, [on]);

  return (
    <div
      ref={layerRef}
      className="torch"
      data-on={on || undefined}
      data-paused={(on && paused) || undefined}
      aria-hidden="true"
    >
      <div className="torch__dark" />
      <div className="torch__haze" />
    </div>
  );
}
