import { useImperativeHandle, useRef } from "react";
import type { Ref } from "react";

import type { Light } from "#/lib/matrix-flashlight";
import { prefersReducedMotion } from "#/lib/reduced-motion";

/** Feed it the beam every frame: `update(light)`, from the engine's `onLight`. */
export interface MothHandle {
  update: (light: Light) => void;
}

/** Size of the moth in CSS pixels (see moth.css). */
const SIZE = 18;
/** Its orbit, as a share of the beam radius: inside the lit disc, out of the hot core. */
const ORBIT = 0.36;
/** Radians per second around the beam on average; the pace wanders around it. */
const ORBIT_RATE = 2.2;
/** How fast the moth closes on its place in the orbit, per second: it lags a moving beam. */
const FOLLOW = 4.5;
/** Pixels of flutter around its path. */
const FLUTTER = 2.5;
/** Below this beam power the moth is not there. A dimmed beam (the SOS) still keeps it. */
const DARK = 0.1;
/** With less motion it sits still here: up and to the right of the beam centre. */
const PERCH_ANGLE = -0.7;

interface Flight {
  x: number;
  y: number;
  /** Seconds of flight, for the wander of its pace and reach. */
  t: number;
  /** Where it is on the orbit, in radians. */
  angle: number;
  /** Where its head points, in radians; 0 is up. */
  heading: number;
  /** How much of it shows, 0..1. */
  alpha: number;
  last: number;
  transform: string;
  opacity: string;
}

function approach(value: number, target: number, rate: number, dt: number): number {
  return value + (target - value) * (1 - Math.exp(-rate * dt));
}

/** The shortest turn from one heading to another, in -π..π. */
function turn(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

/**
 * A live moth that circles the beam: a lagging, slightly erratic orbit at a
 * fraction of the beam's radius. It shows only while the beam has power. Its
 * place is written as a transform on its own element each frame; React does
 * not render per frame. With less motion it sits still next to the beam and
 * does not flap.
 *
 * `from`: where it starts, in viewport pixels (the place it was found);
 * otherwise it starts on the beam.
 */
export function Moth({ ref, from }: { ref?: Ref<MothHandle>; from?: { x: number; y: number } }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<Flight | null>(null);
  const fromRef = useRef(from);

  useImperativeHandle(
    ref,
    () => ({
      update(light) {
        const element = elementRef.current;
        if (!element) return;
        const now = performance.now();
        const start = fromRef.current ?? light;
        const flight = (flightRef.current ??= {
          x: start.x,
          y: start.y,
          t: Math.random() * 100,
          angle: Math.random() * Math.PI * 2,
          heading: 0,
          alpha: 0,
          last: now,
          transform: "",
          opacity: "",
        });
        const dt = Math.min(0.05, (now - flight.last) / 1000);
        flight.last = now;
        const calm = prefersReducedMotion();
        const lit = light.power > DARK ? 1 : 0;

        if (calm) {
          // Perched next to the beam, head up. It moves only with the beam.
          const reach = light.radius * ORBIT;
          flight.x = light.x + reach * Math.cos(PERCH_ANGLE);
          flight.y = light.y + reach * Math.sin(PERCH_ANGLE);
          flight.heading = 0;
          flight.alpha = lit;
        } else {
          flight.t += dt;
          const t = flight.t;
          // Pace and reach wander on incommensurate waves: never quite a circle.
          flight.angle += dt * (ORBIT_RATE + 1.2 * Math.sin(t * 0.83) + 0.6 * Math.sin(t * 2.9));
          const reach =
            light.radius * (ORBIT + 0.06 * Math.sin(t * 1.3) + 0.05 * Math.sin(t * 3.7 + 1));
          const targetX = light.x + reach * Math.cos(flight.angle) + FLUTTER * Math.sin(t * 17);
          const targetY =
            light.y + reach * 0.8 * Math.sin(flight.angle) + FLUTTER * Math.cos(t * 13.3);
          const x = approach(flight.x, targetX, FOLLOW, dt);
          const y = approach(flight.y, targetY, FOLLOW, dt);
          // The head points where it flies.
          if (Math.hypot(x - flight.x, y - flight.y) > 0.05) {
            const course = Math.atan2(y - flight.y, x - flight.x) + Math.PI / 2;
            const heading =
              flight.heading + turn(flight.heading, course) * (1 - Math.exp(-10 * dt));
            // Kept in -π..π: a moth that circles for an hour has no huge angle.
            flight.heading = Math.atan2(Math.sin(heading), Math.cos(heading));
          }
          flight.x = x;
          flight.y = y;
          flight.alpha = approach(flight.alpha, lit, lit ? 5 : 9, dt);
          if (Math.abs(flight.alpha - lit) < 0.01) flight.alpha = lit;
        }

        const transform = `translate3d(${(flight.x - SIZE / 2).toFixed(1)}px, ${(flight.y - SIZE / 2).toFixed(1)}px, 0) rotate(${((flight.heading * 180) / Math.PI).toFixed(1)}deg)`;
        if (transform !== flight.transform) {
          flight.transform = transform;
          element.style.transform = transform;
        }
        const opacity = flight.alpha.toFixed(2);
        if (opacity !== flight.opacity) {
          flight.opacity = opacity;
          element.style.opacity = opacity;
          // In the dark it is not painted and does not flap.
          element.toggleAttribute("data-dark", flight.alpha === 0);
        }
      },
    }),
    [],
  );

  return (
    <div ref={elementRef} className="moth" data-dark="" aria-hidden="true">
      <svg viewBox="0 0 24 24" width={SIZE} height={SIZE} focusable="false">
        <g className="moth__wing" data-side="left">
          <path d="M11 9.6 C8 6.6 4.4 5.6 2.6 6.6 C2.2 9.6 4.4 12.4 11 12.8 Z" />
          <path d="M11 13.4 C8.4 13.6 6 15.2 5.8 17.8 C7.8 18.6 10 17 11.2 15.4 Z" />
        </g>
        <g className="moth__wing" data-side="right">
          <path d="M13 9.6 C16 6.6 19.6 5.6 21.4 6.6 C21.8 9.6 19.6 12.4 13 12.8 Z" />
          <path d="M13 13.4 C15.6 13.6 18 15.2 18.2 17.8 C16.2 18.6 14 17 12.8 15.4 Z" />
        </g>
        <path
          className="moth__feelers"
          d="M11.4 7.4 C10.8 5.6 9.6 4.2 8.2 3.6 M12.6 7.4 C13.2 5.6 14.4 4.2 15.8 3.6"
        />
        <ellipse className="moth__body" cx="12" cy="12.6" rx="1.25" ry="4.6" />
      </svg>
    </div>
  );
}
