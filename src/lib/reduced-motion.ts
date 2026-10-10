export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * `true` when the system asks for less motion, or the reader chose "calm".
 * `prefs.ts` folds both into one attribute, `html[data-calm]`, and the CSS
 * keys on that attribute only.
 *
 * It is cheap enough to call every frame. `false` on the server, where there
 * is no motion to reduce.
 */
export function prefersReducedMotion(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute("data-calm");
}
