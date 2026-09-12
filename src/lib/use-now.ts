"use client";

import { useSyncExternalStore } from "react";

/**
 * A clock the render can read without being impure.
 *
 * Several screens compare against "now" — SLA breaches, a 30-day window, the
 * hours left before a ticket is due. Calling `Date.now()` during render makes
 * the output depend on when React happened to re-render, which is both
 * non-deterministic and flagged by the React compiler's purity rule.
 *
 * The clock lives outside React: one module-level timer updates a plain number
 * and notifies subscribers, and a render only ever reads that number. Screens
 * that show "hours remaining" therefore also refresh on their own instead of
 * freezing at whatever the time was when the page first painted.
 */
const TICK_MS = 30_000;

let current = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  current = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!timer) timer = setInterval(tick, TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Milliseconds since the epoch, refreshed every 30 seconds. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}
