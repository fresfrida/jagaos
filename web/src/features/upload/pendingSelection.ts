/** Hands what was picked in the universal Upload sheet to the Upload page
 * (2026-09-24, round 16, item 10c).
 *
 * The upload itself (photo clean-up, the request, the progress moment, the review
 * queue that follows) belongs to the Upload page and its `useUploadFlow`. The sheet
 * can be opened from any page, and a File cannot travel in a URL, so a chosen file
 * is parked here for exactly one reader, and the sheet then navigates to /upload.
 * The page takes it on mount, or straight away if it is already mounted (the event
 * covers that case), and starts the upload as if it had been picked there.
 *
 * A module-level slot rather than context or storage: it holds live File objects
 * for a few milliseconds between two components that are not related in the tree. */

import { navigate } from '../../router/navigate'
import { routeHref } from '../../router/routes'

export type UploadSelection =
  | { kind: 'document'; files: File[] }
  | { kind: 'photo'; file: File }

const HANDED_OFF_EVENT = 'jagaos:upload-selection'

let pending: UploadSelection | null = null

export function handOffSelection(selection: UploadSelection): void {
  pending = selection
  navigate(routeHref('upload'))
  window.dispatchEvent(new CustomEvent(HANDED_OFF_EVENT))
}

/** Returns the parked selection once, then nothing. */
export function takePendingSelection(): UploadSelection | null {
  const selection = pending
  pending = null
  return selection
}

export function onSelectionHandedOff(handler: () => void): () => void {
  window.addEventListener(HANDED_OFF_EVENT, handler)
  return () => window.removeEventListener(HANDED_OFF_EVENT, handler)
}
