/**
 * What the reader chose and where the reader was, kept on this device.
 *
 * `localStorage` holds ids, hashes, numbers and preferences only: never
 * document text, never search queries. Everything read back is validated,
 * because the stored value may be old, foreign or broken.
 *
 * This module must stay free of content imports: the Enter page uses it.
 */

import { useRef, useSyncExternalStore } from "react";

import { REDUCED_MOTION_QUERY } from "#/lib/reduced-motion";

export type VibeId = "ultraviolet" | "phosphor" | "sodium" | "cryo";

/**
 * Where the reader is in one document. The fields of `Prefs` with the same
 * names belong to the open document (`Prefs.doc`); `Prefs.shelf` keeps them
 * for every other document.
 */
export interface DocProgress {
  /** Ids of the blocks the reader dwelt on. */
  read: string[];
  /** Block id of the last reading position. */
  last: string | null;
  /** 0..100, for the Enter page "continue" chip and the library. */
  percent: number;
  /**
   * `fnv1a(section id)` -> section hash at the last visit. The key is hashed
   * because a section id is a heading slug: words of the document.
   */
  hashes: Record<string, string>;
}

export interface Prefs extends DocProgress {
  vibe: VibeId;
  size: "s" | "m" | "l";
  motion: "full" | "calm";
  /** Entered once: the fast lane. */
  seen: boolean;
  /** Ids of the objects found on the Enter page. */
  found: string[];
  /**
   * Slug of the open document, or of the one the reader was in last: ENTER
   * goes there. `read`, `last`, `percent` and `hashes` are its progress.
   * `null`: no document was opened yet, or the progress was stored before
   * there were several documents; the first document opened takes it.
   */
  doc: string | null;
  /** Slug -> progress of every document but the open one. */
  shelf: Record<string, DocProgress>;
}

const PREFS_KEY = "mf:v1";

const VIBE_IDS: readonly VibeId[] = ["ultraviolet", "phosphor", "sodium", "cryo"];
export const SIZES: readonly Prefs["size"][] = ["s", "m", "l"];
export const MOTIONS: readonly Prefs["motion"][] = ["full", "calm"];

/** Longest id that is kept. Real ids are far shorter. */
const MAX_ID_LENGTH = 200;
/** Most ids that one list keeps. A document has far fewer blocks. */
const MAX_IDS = 20_000;
/** Most documents whose progress is kept. A site has far fewer. */
const MAX_DOCS = 200;

export const DEFAULT_PREFS: Prefs = Object.freeze({
  vibe: "ultraviolet",
  size: "m",
  motion: "full",
  seen: false,
  found: [],
  doc: null,
  shelf: {},
  read: [],
  last: null,
  percent: 0,
  hashes: {},
});

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(isId))].slice(0, MAX_IDS);
}

function hashMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, hash] of Object.entries(value).slice(0, MAX_IDS)) {
    if (isId(key) && isId(hash)) result[key] = hash;
  }
  return result;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sanitizeProgress(value: unknown): DocProgress {
  const raw = record(value);
  const percent = typeof raw.percent === "number" && Number.isFinite(raw.percent) ? raw.percent : 0;
  return {
    read: idList(raw.read),
    last: isId(raw.last) ? raw.last : null,
    percent: Math.min(100, Math.max(0, Math.round(percent))),
    hashes: hashMap(raw.hashes),
  };
}

function shelfOf(value: unknown, open: string | null): Record<string, DocProgress> {
  const result: Record<string, DocProgress> = {};
  for (const [slug, progress] of Object.entries(record(value)).slice(0, MAX_DOCS)) {
    if (isId(slug) && slug !== open) result[slug] = sanitizeProgress(progress);
  }
  return result;
}

/** Turns anything into valid preferences. Each bad field falls back alone. */
function sanitizePrefs(value: unknown): Prefs {
  const raw = record(value);
  const doc = isId(raw.doc) ? raw.doc : null;

  return {
    vibe: oneOf(raw.vibe, VIBE_IDS, DEFAULT_PREFS.vibe),
    size: oneOf(raw.size, SIZES, DEFAULT_PREFS.size),
    motion: oneOf(raw.motion, MOTIONS, DEFAULT_PREFS.motion),
    seen: raw.seen === true,
    found: idList(raw.found),
    doc,
    shelf: shelfOf(raw.shelf, doc),
    ...sanitizeProgress(raw),
  };
}

/** `null` where there is no storage: on the server, or when the browser blocks it. */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readStored(): Prefs {
  try {
    const stored = storage()?.getItem(PREFS_KEY);
    return stored ? sanitizePrefs(JSON.parse(stored)) : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function writeStored(prefs: Prefs) {
  try {
    storage()?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage is full or blocked: the choice still holds for this visit.
  }
}

let systemMotion: MediaQueryList | null = null;

/**
 * The look is set on <html>, so CSS follows it without a render.
 * `data-calm`: the reader chose "calm", or the system asks for less motion.
 */
function applyToDocument(prefs: Prefs) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const { dataset } = root;
  if (dataset.vibe !== prefs.vibe) dataset.vibe = prefs.vibe;
  if (dataset.size !== prefs.size) dataset.size = prefs.size;
  if (dataset.motion !== prefs.motion) dataset.motion = prefs.motion;
  systemMotion ??= window.matchMedia(REDUCED_MOTION_QUERY);
  root.toggleAttribute("data-calm", prefs.motion === "calm" || systemMotion.matches);
}

let state: Prefs = DEFAULT_PREFS;
let loaded = false;
const listeners = new Set<() => void>();

function commit(next: Prefs) {
  state = next;
  applyToDocument(next);
  for (const listener of listeners) listener();
}

/** Reads the stored value on first use in a browser. The server keeps the defaults. */
function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  state = readStored();
  applyToDocument(state);
  // The system setting can change while the page is open.
  systemMotion?.addEventListener("change", () => applyToDocument(state));

  // Another tab changed or cleared the preferences.
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== PREFS_KEY) return;
    commit(readStored());
  });
}

export function getPrefs(): Prefs {
  load();
  return state;
}

export function setPrefs(patch: Partial<Prefs> | ((prefs: Prefs) => Partial<Prefs>)): void {
  const current = getPrefs();
  const change = typeof patch === "function" ? patch(current) : patch;

  // A field that is `undefined` in the patch stays as it is.
  const merged: Record<string, unknown> = { ...current };
  let changed = false;
  for (const key of Object.keys(change) as (keyof Prefs)[]) {
    if (change[key] === undefined) continue;
    merged[key] = change[key];
    if (!Object.is(change[key], current[key])) changed = true;
  }
  if (!changed) return;

  const next = sanitizePrefs(merged);
  writeStored(next);
  commit(next);
}

/** Forgets everything on this device and returns to the defaults. */
export function clearPrefs(): void {
  load();
  try {
    storage()?.removeItem(PREFS_KEY);
  } catch {
    // Nothing was stored, or storage is blocked.
  }
  commit(DEFAULT_PREFS);
}

const NO_PROGRESS: DocProgress = Object.freeze({ read: [], last: null, percent: 0, hashes: {} });

/** The progress of the document `slug`: open or on the shelf. */
export function progressOf(prefs: Prefs, slug: string): DocProgress {
  if (prefs.doc === slug) {
    const { read, last, percent, hashes } = prefs;
    return { read, last, percent, hashes };
  }
  return prefs.shelf[slug] ?? NO_PROGRESS;
}

/**
 * Makes `slug` the open document: the progress of the document that was open
 * goes on the shelf, and the progress of `slug` comes off it. Nothing is lost
 * either way. Opening the open document again changes nothing.
 */
export function openDoc(slug: string): void {
  setPrefs((prefs) => {
    if (prefs.doc === slug) return {};
    // No document was open: the progress there is, is this one's.
    if (prefs.doc === null) return { doc: slug };
    const { [slug]: next = NO_PROGRESS, ...shelf } = prefs.shelf;
    shelf[prefs.doc] = progressOf(prefs, prefs.doc);
    return { doc: slug, shelf, ...next };
  });
}

/**
 * Changes the progress of the document `slug`, open or not. The reading
 * tracker of a document that is closing still saves its place: it goes on
 * the shelf, not into the document that is open now.
 */
export function setProgress(
  slug: string,
  patch: Partial<DocProgress> | ((progress: DocProgress) => Partial<DocProgress>),
): void {
  setPrefs((prefs) => {
    const current = progressOf(prefs, slug);
    const change = typeof patch === "function" ? patch(current) : patch;
    if (prefs.doc === slug || prefs.doc === null) return change;

    const next: DocProgress = { ...current };
    let changed = false;
    for (const key of Object.keys(change) as (keyof DocProgress)[]) {
      if (change[key] === undefined || Object.is(change[key], current[key])) continue;
      (next as unknown as Record<string, unknown>)[key] = change[key];
      changed = true;
    }
    return changed ? { shelf: { ...prefs.shelf, [slug]: next } } : {};
  });
}

/** Calls `listener` after every change. For modules; components use `usePrefs`. */
export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Same value, or two arrays or plain objects with the same entries. */
function sameShallow(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) =>
    Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * The selected part of the preferences. The component renders again only when
 * that part changes. A selector may build a small object or array: a result
 * with the same entries as the last one keeps its identity.
 */
export function usePrefs<T>(select: (prefs: Prefs) => T): T {
  const cache = useRef<{ prefs: Prefs; select: (prefs: Prefs) => T; value: T } | null>(null);

  const pick = (prefs: Prefs): T => {
    const cached = cache.current;
    if (cached && cached.prefs === prefs && cached.select === select) return cached.value;
    const value = select(prefs);
    const stable = cached && sameShallow(cached.value, value) ? cached.value : value;
    cache.current = { prefs, select, value: stable };
    return stable;
  };

  return useSyncExternalStore(
    subscribePrefs,
    () => pick(getPrefs()),
    // The prerendered shell and the first client render both show the defaults.
    () => pick(DEFAULT_PREFS),
  );
}

/**
 * Runs in <head> before the first paint, so the page never flashes the
 * default look. It only copies three validated words to <html>, and sets
 * `data-calm` the way `applyToDocument` does.
 */
export const PREFS_BOOT_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(
  PREFS_KEY,
)})||"{}")||{},d=document.documentElement,s=function(k,a){if(typeof p[k]==="string"&&a.indexOf(p[k])>-1)d.setAttribute("data-"+k,p[k])};s("vibe",${JSON.stringify(
  VIBE_IDS,
)});s("size",${JSON.stringify(SIZES)});s("motion",${JSON.stringify(MOTIONS)});if(p.motion==="calm"||matchMedia(${JSON.stringify(
  REDUCED_MOTION_QUERY,
)}).matches)d.setAttribute("data-calm","")}catch(e){}})();`;
