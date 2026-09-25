/** How many API calls are in flight right now (2026-09-25, DECISIONS #108). One number, kept where every JSON call to the
 * backend already passes (lib/apiClient.ts), so the app can tell "this page has finished loading" from "it is still asking for
 * its data". The footer uses it (hooks/usePageSettled.ts): it stays out of sight until the page is quiet, which is what lets
 * `<main>` be exactly as tall as its content instead of a fixed near-viewport height that kept the footer from jumping.
 * Blob fetches (thumbnails, the document viewer) are not counted: they fill boxes that already have their size. */

import { useSyncExternalStore } from 'react'

let inFlight = 0
const listeners = new Set<() => void>()

function change(delta: 1 | -1): void {
  inFlight += delta
  for (const listener of listeners) listener()
}

/** Counts `promise` as in flight until it settles, either way. Returns the same promise, so the caller's own handling is unchanged. */
export function trackRequest<T>(promise: Promise<T>): Promise<T> {
  change(1)
  const done = () => change(-1)
  promise.then(done, done)
  return promise
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePendingRequests(): number {
  return useSyncExternalStore(subscribe, () => inFlight, () => 0)
}
