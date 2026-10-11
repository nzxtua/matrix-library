/**
 * Where the reader is, and what the reader has read.
 *
 * - The current block is the one under the reading line.
 * - The current section is the section of that block, with one exception: a
 *   section heading that is still on screen above the line keeps its section
 *   current. So a jump to a short section shows that section, not the next.
 * - Scroll progress goes to listeners, at most once per frame, and never
 *   through React state.
 * - A block counts as read when it stays in the middle band of the viewport
 *   for a dwell time that grows with its words. Scrolling past does not count.
 *   A block at the very start or end of the page cannot reach the band: it
 *   counts when most of it stays on screen for the same time.
 * - A section has "changed" when its hash differs from the one stored at the
 *   last visit.
 *
 * One `scroll` listener and two `IntersectionObserver`s do all of it. React
 * state changes only when the current section or block changes, or when a
 * block becomes read.
 */

import { useSyncExternalStore } from "react";

import { fnv1a } from "#/lib/hash";
import type { Block, MarkdownDocument } from "#/lib/markdown";
import { getPrefs, progressOf, setProgress, subscribePrefs } from "#/lib/prefs";
import { getUi } from "#/lib/ui";

/** The reading line: this far under the top edge, in CSS pixels. */
const READING_LINE = 140;
/** On a short viewport the line is this share of its height instead. */
const READING_LINE_SHARE = 0.3;

/** The reading line for a viewport this tall, in CSS pixels under its top edge. */
export function readingLine(viewport: number = window.innerHeight): number {
  return Math.min(READING_LINE, viewport * READING_LINE_SHARE);
}

/** The middle band: a quarter of the viewport is cut off at the top and at the bottom. */
const BAND_MARGIN = "-25% 0px -25% 0px";
/** The share of the viewport that `BAND_MARGIN` cuts off on each side. */
const BAND_CUT = 0.25;
/** A block that cannot reach the band is seen when this share of it is on screen. */
const EDGE_VISIBLE = 0.6;

const MIN_DWELL_MS = 1200;
const MAX_DWELL_MS = 9000;
/** About a third of the time it takes to read a word at 220 words per minute. */
const DWELL_PER_WORD_MS = 90;

/** The reading position is stored this long after it last changed. */
const SAVE_DELAY_MS = 800;

const NO_SECTIONS: ReadonlySet<string> = new Set();

/** What `startReading` knows about a document, apart from the DOM. */
interface Model {
  document: MarkdownDocument;
  /** Block id -> its weight in the read share: its words, at least 1. */
  weights: Map<string, number>;
  sectionOf: Map<string, string>;
  sectionWeights: Map<string, number>;
  total: number;
}

let model: Model | null = null;
let currentSection: string | undefined;
let currentBlock: string | undefined;
let progress = 0;
let shares = new Map<string, number>();
let percent = 0;
let changedSections: ReadonlySet<string> = NO_SECTIONS;

/** Per document: the stored hashes as they were before this page load overwrote them. */
const baselines = new WeakMap<MarkdownDocument, Record<string, string>>();

const stateListeners = new Set<() => void>();
const progressListeners = new Set<(progress: number) => void>();

function notify() {
  for (const listener of stateListeners) listener();
}

function subscribe(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

function weightOf(block: Block): number {
  return Math.max(1, block.words);
}

function buildModel(document: MarkdownDocument): Model {
  const weights = new Map<string, number>();
  const sectionOf = new Map<string, string>();
  const sectionWeights = new Map<string, number>();
  let total = 0;
  for (const block of document.blocks) {
    const weight = weightOf(block);
    weights.set(block.id, weight);
    sectionOf.set(block.id, block.sectionId);
    sectionWeights.set(block.sectionId, (sectionWeights.get(block.sectionId) ?? 0) + weight);
    total += weight;
  }
  return { document, weights, sectionOf, sectionWeights, total };
}

/** Read share of every section (0..1) and of the whole document (0..100), by words. */
function measureRead(
  { weights, sectionOf, sectionWeights, total }: Model,
  read: readonly string[],
): { shares: Map<string, number>; percent: number } {
  const readWeights = new Map<string, number>();
  let sum = 0;
  for (const id of new Set(read)) {
    const weight = weights.get(id);
    if (weight === undefined) continue;
    const section = sectionOf.get(id) ?? "";
    readWeights.set(section, (readWeights.get(section) ?? 0) + weight);
    sum += weight;
  }

  const result = new Map<string, number>();
  for (const [section, weight] of readWeights) {
    result.set(section, Math.min(1, weight / (sectionWeights.get(section) ?? weight)));
  }
  return { shares: result, percent: total > 0 ? Math.round((sum / total) * 100) : 0 };
}

/**
 * The key of a section in the stored hashes. A section id is a heading slug:
 * words of the document. Storage must hold no document text, so the id is
 * hashed too.
 */
function storedKey(sectionId: string): string {
  return fnv1a(sectionId);
}

/** Sections that are new or different since the stored hashes were written. */
function findChanged(
  document: MarkdownDocument,
  hashes: Record<string, string>,
): ReadonlySet<string> {
  // Nothing stored: a first visit. Nothing has "changed" for a new reader.
  if (Object.keys(hashes).length === 0) return NO_SECTIONS;
  const changed = new Set<string>();
  for (const section of document.sections) {
    if (hashes[storedKey(section.id)] !== section.hash) changed.add(section.id);
  }
  return changed;
}

function sameHashes(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function dwellFor(block: Block): number {
  return Math.min(MAX_DWELL_MS, Math.max(MIN_DWELL_MS, block.words * DWELL_PER_WORD_MS));
}

/**
 * Starts to follow the reader through `document`, rendered inside `root`
 * (every block is an element with `id={block.id}`). Call it once the blocks
 * are in the DOM and `slug` is the open document (`openDoc`). The progress
 * is stored under `slug`. The returned function stops it.
 */
export function startReading(
  document: MarkdownDocument,
  root: HTMLElement,
  slug: string,
): () => void {
  const view = root.ownerDocument.defaultView;
  if (!view) return () => {};
  const page = root.ownerDocument;

  const started = buildModel(document);
  model = started;

  // What changed is computed against the hashes of the last visit, before
  // they are overwritten. The baseline is kept for the whole page load, so
  // the marks survive a second mount and a visit to another document.
  let baseline = baselines.get(document);
  if (!baseline) {
    baseline = progressOf(getPrefs(), slug).hashes;
    baselines.set(document, baseline);
  }
  changedSections = findChanged(document, baseline);

  const hashes: Record<string, string> = {};
  for (const section of document.sections) hashes[storedKey(section.id)] = section.hash;

  // Marks of blocks that no longer exist are dropped: a block that was
  // edited has a new id and is unread again.
  setProgress(slug, (progress) => {
    const read = progress.read.filter((id) => started.weights.has(id));
    return {
      hashes: sameHashes(progress.hashes, hashes) ? progress.hashes : hashes,
      read: read.length === progress.read.length ? progress.read : read,
      last: progress.last !== null && !started.weights.has(progress.last) ? null : progress.last,
    };
  });

  let readSource = progressOf(getPrefs(), slug).read;
  let readSet = new Set(readSource);
  ({ shares, percent } = measureRead(started, readSource));

  /** The blocks that are in the DOM, in document order. */
  const entries: { block: Block; element: HTMLElement }[] = [];
  const blockOf = new Map<Element, Block>();
  for (const block of document.blocks) {
    const element = page.getElementById(block.id);
    if (!element || !root.contains(element)) continue;
    entries.push({ block, element });
    blockOf.set(element, block);
  }

  // ── Read marks: dwell in the middle band ──────────────────────────────

  const dwelling = new Map<string, ReturnType<typeof setTimeout>>();
  /** Blocks that cross the middle band now. */
  const inBand = new Set<Block>();
  /** Blocks that cannot reach the band: they sit at the very start or end of the page. */
  let edge = new Set<Block>();
  /** The blocks of `edge` that are mostly on screen now. */
  const inView = new Set<Block>();

  /** The reader can be reading this block now. */
  const watched = (block: Block) => inBand.has(block) || inView.has(block);

  const stopDwell = (block: Block) => {
    clearTimeout(dwelling.get(block.id));
    dwelling.delete(block.id);
  };

  const startDwell = (block: Block) => {
    if (readSet.has(block.id) || dwelling.has(block.id) || page.hidden) return;
    dwelling.set(
      block.id,
      setTimeout(() => {
        dwelling.delete(block.id);
        if (!watched(block)) return;
        // With the lights out nobody reads. Wait again.
        if (getUi().overlay === "curtain") {
          startDwell(block);
          return;
        }
        const read = [...progressOf(getPrefs(), slug).read, block.id];
        setProgress(slug, { read, percent: measureRead(started, read).percent });
      }, dwellFor(block)),
    );
  };

  const startDwells = () => {
    for (const block of inBand) startDwell(block);
    for (const block of inView) startDwell(block);
  };

  const stopDwells = () => {
    for (const block of inBand) stopDwell(block);
    for (const block of inView) stopDwell(block);
  };

  /** One observer callback: `seen` is the set this observer keeps. */
  const watch = (seen: Set<Block>, isSeen: (change: IntersectionObserverEntry) => boolean) => {
    return (changes: IntersectionObserverEntry[]) => {
      for (const change of changes) {
        const block = blockOf.get(change.target);
        if (!block) continue;
        if (isSeen(change)) seen.add(block);
        else seen.delete(block);
        if (watched(block)) startDwell(block);
        else stopDwell(block);
      }
    };
  };

  const band = new view.IntersectionObserver(
    watch(inBand, (change) => change.isIntersecting),
    { rootMargin: BAND_MARGIN },
  );
  for (const { element } of entries) band.observe(element);

  // The whole viewport, for the blocks of `edge` only.
  const edgeView = new view.IntersectionObserver(
    watch(inView, (change) => change.isIntersecting && change.intersectionRatio >= EDGE_VISIBLE),
    { threshold: EDGE_VISIBLE },
  );

  /** Moves the second observer to the blocks that are at an edge now. */
  const setEdge = (next: Set<Block>) => {
    for (const { block, element } of entries) {
      if (next.has(block) === edge.has(block)) continue;
      if (next.has(block)) {
        edgeView.observe(element);
      } else {
        edgeView.unobserve(element);
        inView.delete(block);
        if (!watched(block)) stopDwell(block);
      }
    }
    edge = next;
  };

  // ── Position: current block, current section, scroll progress ──────────

  /** Top and bottom of every entry, in CSS pixels from the top of the page. */
  let tops = new Float64Array(entries.length);
  let bottoms = new Float64Array(entries.length);
  /**
   * For a section heading: the top of the heading itself, which is where a
   * jump puts the top edge. For every other entry: its top.
   */
  let anchors = new Float64Array(entries.length);
  let measured = false;
  /** The block the reader was on when reading started. */
  let firstBlock: string | undefined;
  /** The reader has left `firstBlock`. Until then there is no position worth storing. */
  let moved = false;
  let frame = 0;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const measure = () => {
    const scrollY = view.scrollY;
    if (tops.length !== entries.length) {
      tops = new Float64Array(entries.length);
      bottoms = new Float64Array(entries.length);
      anchors = new Float64Array(entries.length);
    }
    for (let index = 0; index < entries.length; index++) {
      const { block, element } = entries[index];
      const box = element.getBoundingClientRect();
      tops[index] = box.top + scrollY;
      bottoms[index] = box.bottom + scrollY;
      anchors[index] = tops[index];
      if (block.heading && block.heading.depth <= 2) {
        const heading = page.getElementById(block.heading.id);
        if (heading && element.contains(heading)) {
          anchors[index] = heading.getBoundingClientRect().top + scrollY;
        }
      }
    }
    measured = true;

    // The band never reaches a block that ends above it when the page is at
    // its start, or one that starts under it when the page is at its end.
    const viewport = view.innerHeight;
    const maxScroll = Math.max(0, page.documentElement.scrollHeight - viewport);
    const bandTop = viewport * BAND_CUT;
    const bandBottom = maxScroll + viewport * (1 - BAND_CUT);
    const next = new Set<Block>();
    for (let index = 0; index < entries.length; index++) {
      if (bottoms[index] <= bandTop || tops[index] >= bandBottom) next.add(entries[index].block);
    }
    setEdge(next);
  };

  const saveLast = () => {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (moved && currentBlock !== undefined) setProgress(slug, { last: currentBlock });
  };

  const update = () => {
    frame = 0;
    if (!measured) measure();

    const scrollY = view.scrollY;
    const viewport = view.innerHeight;
    const maxScroll = Math.max(0, page.documentElement.scrollHeight - viewport);

    const nextProgress = maxScroll > 0 ? Math.min(1, Math.max(0, scrollY / maxScroll)) : 0;
    if (nextProgress !== progress) {
      progress = nextProgress;
      for (const listener of progressListeners) listener(progress);
    }

    if (entries.length === 0) return;

    // The last entry whose top is above the reading line. At the very end of
    // the page the last block is current, though it never reaches the line.
    let index = entries.length - 1;
    if (maxScroll === 0 || scrollY < maxScroll - 2) {
      const line = scrollY + readingLine(viewport);
      let low = 0;
      let high = entries.length - 1;
      index = 0;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (tops[middle] <= line) {
          index = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
    }

    // The section. A jump puts a heading under the top edge, above the line.
    // When the section is short, the next heading is above the line too. The
    // first section heading that is still on screen wins: the one the reader
    // went to, and while scrolling the one that came up first.
    let sectionIndex = index;
    for (let k = index; k >= 0 && bottoms[k] > scrollY; k--) {
      const heading = entries[k].block.heading;
      if (heading && heading.depth <= 2 && anchors[k] >= scrollY - 1) sectionIndex = k;
    }

    const { block } = entries[index];
    const nextSection = entries[sectionIndex].block.sectionId || undefined;
    const blockChanged = block.id !== currentBlock;
    if (!blockChanged && nextSection === currentSection) return;

    if (firstBlock === undefined) firstBlock = block.id;
    currentBlock = block.id;
    currentSection = nextSection;
    notify();
    if (!blockChanged) return;

    // The position is stored once the reader has moved, and not on every
    // block that passes: only where the reader stops.
    if (block.id !== firstBlock) moved = true;
    if (moved) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveLast, SAVE_DELAY_MS);
    }
  };

  const schedule = () => {
    frame ||= view.requestAnimationFrame(update);
  };

  // The layout moved (fonts, text size, a folded block, the window): the
  // tops are measured again, in the next frame.
  const remeasure = () => {
    measured = false;
    schedule();
  };

  // The read marks live in the preferences. They also change from outside:
  // "clear my data", or another tab.
  const unsubscribePrefs = subscribePrefs(() => {
    const progress = progressOf(getPrefs(), slug);
    if (progress.read === readSource) return;
    readSource = progress.read;
    readSet = new Set(readSource);
    ({ shares, percent } = measureRead(started, readSource));
    if (Object.keys(progress.hashes).length === 0) changedSections = NO_SECTIONS;
    // A block that is unread again starts its dwell again.
    startDwells();
    notify();
  });

  const onVisibility = () => {
    if (page.hidden) {
      stopDwells();
      saveLast();
    } else {
      startDwells();
    }
  };

  const listeners = new AbortController();
  const { signal } = listeners;
  view.addEventListener("scroll", schedule, { passive: true, signal });
  view.addEventListener("resize", remeasure, { signal });
  view.addEventListener("pagehide", saveLast, { signal });
  page.addEventListener("visibilitychange", onVisibility, { signal });
  const resizes = new view.ResizeObserver(remeasure);
  resizes.observe(root);

  update();
  notify();

  return () => {
    listeners.abort();
    resizes.disconnect();
    band.disconnect();
    edgeView.disconnect();
    unsubscribePrefs();
    view.cancelAnimationFrame(frame);
    for (const timer of dwelling.values()) clearTimeout(timer);
    saveLast();

    if (model === started) {
      model = null;
      currentSection = undefined;
      currentBlock = undefined;
      notify();
    }
  };
}

/** Id of the current nav section. `undefined` before reading starts. */
export function useCurrentSection(): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => currentSection,
    () => undefined,
  );
}

/** Id of the block under the reading line, read once: for event handlers. */
export function getCurrentBlock(): string | undefined {
  return currentBlock;
}

/** Id of the block under the reading line. Changes only when that block changes. */
export function useCurrentBlock(): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => currentBlock,
    () => undefined,
  );
}

/**
 * Scroll progress of the page, 0..1, at most once per frame. The listener is
 * also called at once with the current value. Write the value to a small
 * element (a transform, a custom property on that element): never to state.
 */
export function onScrollProgress(listener: (progress: number) => void): () => void {
  progressListeners.add(listener);
  listener(progress);
  return () => progressListeners.delete(listener);
}

/** Read share of one section, 0..1, by the words of its read blocks. */
export function useReadShare(sectionId: string): number {
  return useSyncExternalStore(
    subscribe,
    () => shares.get(sectionId) ?? 0,
    () => 0,
  );
}

/** Read share of the whole document, 0..100. */
export function useReadPercent(): number {
  return useSyncExternalStore(
    subscribe,
    () => percent,
    () => 0,
  );
}

/** Sections whose hash differs from the last visit. */
export function useChangedSections(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => changedSections,
    () => NO_SECTIONS,
  );
}
