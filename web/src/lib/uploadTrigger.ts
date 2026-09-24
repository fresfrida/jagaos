/** Opens the universal Upload sheet from anywhere (2026-09-24, round 16, item
 * 10c). The bottom nav's raised Upload button used to navigate to /upload, or,
 * when already there, scroll to and focus the page's own choice (round 12). It now
 * opens one bottom sheet with the DOCUMENT / PHOTO choice on EVERY page, this one
 * included, so the behaviour no longer depends on where you are.
 *
 * A plain window CustomEvent, not a React Context: the button (BottomNav) and the
 * sheet (UploadSheetHost) are siblings under App with nothing else in common, and
 * this is a single fire-and-forget signal, not shared state. The same event opens
 * the sheet from "Upload a replacement" after a rejection. */

const OPEN_UPLOAD_SHEET_EVENT = 'jagaos:open-upload-sheet'

export function openUploadSheet(): void {
  window.dispatchEvent(new CustomEvent(OPEN_UPLOAD_SHEET_EVENT))
}

export function onOpenUploadSheet(handler: () => void): () => void {
  window.addEventListener(OPEN_UPLOAD_SHEET_EVENT, handler)
  return () => window.removeEventListener(OPEN_UPLOAD_SHEET_EVENT, handler)
}
