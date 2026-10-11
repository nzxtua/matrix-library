/**
 * Site settings from `src/content/site.json`. Small and free of the document,
 * so the Enter page can read it without loading `src/lib/content`.
 */

import settings from "#/content/site.json";

/** Shown when `site.json` has no usable wordmark. */
const FALLBACK_WORDMARK = "Lights / out";

/**
 * Splits a wordmark into the two rows the Enter page draws: above and below
 * the ENTER button. A "/" sets the break. Without one, the text breaks at the
 * space that makes the two rows closest in length. One word is one row.
 */
export function wordmarkRows(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const slash = clean.indexOf("/");
  if (slash >= 0) {
    return [clean.slice(0, slash), clean.slice(slash + 1).replaceAll("/", " ")]
      .map((row) => row.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }

  let best = -1;
  for (let at = clean.indexOf(" "); at >= 0; at = clean.indexOf(" ", at + 1)) {
    const balance = Math.abs(clean.length - 2 * at);
    if (best < 0 || balance < Math.abs(clean.length - 2 * best)) best = at;
  }
  return best < 0 ? [clean] : [clean.slice(0, best), clean.slice(best + 1)];
}

const configured = typeof settings.wordmark === "string" ? wordmarkRows(settings.wordmark) : [];

/** The rows of the Enter page wordmark, as written (not upper-cased). */
export const wordmark: string[] = configured.length ? configured : wordmarkRows(FALLBACK_WORDMARK);
