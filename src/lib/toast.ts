/**
 * One short message at a time, shown by `components/Toast.tsx` in a polite
 * live region. A new message replaces the one on screen.
 */

import { useSyncExternalStore } from "react";

export interface ToastMessage {
  /** Grows with every message, so the same text twice is two messages. */
  id: number;
  text: string;
}

const SHOWN_MS = 2400;

let current: ToastMessage | null = null;
let count = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: ToastMessage | null) {
  current = next;
  for (const listener of listeners) listener();
}

export function toast(text: string): void {
  if (typeof window === "undefined") return;
  clearTimeout(timer);
  set({ id: ++count, text });
  timer = setTimeout(() => set(null), SHOWN_MS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The message on screen, or `null`. */
export function useToast(): ToastMessage | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}
