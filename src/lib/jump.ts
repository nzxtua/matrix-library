/**
 * Going to a place in the document, and pointing at it.
 *
 * A jump is always instant. The one attention effect is the ping: a ring that
 * expands from the target and fades (CSS in `styles/tokens.css`).
 */

import { copy } from "#/lib/copy";
import { toast } from "#/lib/toast";

const PING_MS = 900;
/** The ring ends this many CSS pixels outside the target, on every side. */
const PING_GROWTH = 14;

const pings = new WeakMap<Element, ReturnType<typeof setTimeout>>();

function styleOf(element: Element): CSSStyleDeclaration | null {
  return element instanceof HTMLElement || element instanceof SVGElement ? element.style : null;
}

/** Sets `data-ping` on the element for 900 ms. A second ping restarts the ring. */
export function ping(element: Element): void {
  const running = pings.get(element);
  if (running !== undefined) {
    clearTimeout(running);
    element.removeAttribute("data-ping");
    // Reading the layout makes the browser see the removal: the animation restarts.
    void element.getBoundingClientRect();
  }

  // The ring grows by a scale. The scale is set from the size of the target,
  // so a table and a chip both get a ring that ends 14 px outside.
  const { width, height } = element.getBoundingClientRect();
  const style = styleOf(element);
  if (style && width > 0 && height > 0) {
    style.setProperty("--ping-sx", ((width + PING_GROWTH * 2) / width).toFixed(4));
    style.setProperty("--ping-sy", ((height + PING_GROWTH * 2) / height).toFixed(4));
  }
  element.setAttribute("data-ping", "");

  pings.set(
    element,
    setTimeout(() => {
      pings.delete(element);
      element.removeAttribute("data-ping");
      style?.removeProperty("--ping-sx");
      style?.removeProperty("--ping-sy");
    }, PING_MS),
  );
}

/**
 * Scrolls instantly (never smooth) so the target sits under the top edge,
 * then pings it. The distance from the edge is the target's
 * `scroll-margin-top`. `target` is an element or an id, with or without "#".
 *
 * Returns `false` when there is no such element.
 */
export function jumpTo(
  target: string | Element,
  options: { ping?: boolean; focus?: boolean } = {},
): boolean {
  if (typeof document === "undefined") return false;
  const element =
    typeof target === "string" ? document.getElementById(target.replace(/^#/, "")) : target;
  if (!element) return false;

  element.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });

  if (options.focus && element instanceof HTMLElement) {
    // Focus moves the keyboard and the screen reader there too.
    if (element.tabIndex < 0 && !element.hasAttribute("tabindex")) element.tabIndex = -1;
    element.focus({ preventScroll: true });
  }
  if (options.ping ?? true) ping(element);
  return true;
}

/** The absolute URL of this page with `#id`. */
export function linkTo(id: string): string {
  const url = new URL(window.location.href);
  url.hash = id;
  return url.href;
}

/** For a page that is not served over HTTPS, where the clipboard API is missing. */
function copyWithSelection(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.append(field);
  field.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  field.remove();
  return copied;
}

/** Copies `text` and says so: `done` (default `copy.copied`), or `copy.copyFailed`. */
export async function copyText(text: string, done: string = copy.copied): Promise<void> {
  let copied: boolean;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    copied = copyWithSelection(text);
  }
  toast(copied ? done : copy.copyFailed);
}
