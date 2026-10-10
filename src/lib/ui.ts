/**
 * What is open right now. In memory only: nothing here is stored.
 *
 * One modal overlay at a time: opening one replaces the other.
 *
 * This module must stay free of content imports: the Enter page uses it.
 */

import { useSyncExternalStore } from "react";

export type Overlay = "spotlight" | "keymap" | "sheet" | "curtain";

export interface UiState {
  overlay: Overlay | null;
  /** The reading ruler is on. Never at the same time as the torch. */
  ruler: boolean;
  /** The torch is on: the page is dark, a beam follows the pointer. Never at the same time as the ruler. */
  torch: boolean;
  /** The code term whose places are lit, or `null`. */
  echo: string | null;
  /** The query whose hits are lit on the page, or `null`. Never stored. */
  searchlight: string | null;
}

let state: UiState = { overlay: null, ruler: false, torch: false, echo: null, searchlight: null };
const initial = state;
const listeners = new Set<() => void>();

function update(patch: Partial<UiState>) {
  let changed = false;
  for (const key of Object.keys(patch) as (keyof UiState)[]) {
    if (patch[key] !== state[key]) changed = true;
  }
  if (!changed) return;
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getUi(): UiState {
  return state;
}

/** The selected part of the state. Select a field, not a new object. */
export function useUi<T>(select: (state: UiState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(initial),
  );
}

/** Opens `name` and closes any other overlay. */
export function openOverlay(name: Overlay): void {
  update({ overlay: name });
}

export function closeOverlay(): void {
  update({ overlay: null });
}

export function toggleOverlay(name: Overlay): void {
  update({ overlay: state.overlay === name ? null : name });
}

/*
 * The ruler and the torch are two ways to read in the light: one at a time.
 * Switching one on switches the other off.
 */

export function setRuler(on: boolean): void {
  update(on ? { ruler: true, torch: false } : { ruler: false });
}

export function setTorch(on: boolean): void {
  update(on ? { torch: true, ruler: false } : { torch: false });
}

export function setEcho(term: string | null): void {
  update({ echo: term });
}

export function setSearchlight(query: string | null): void {
  update({ searchlight: query });
}
