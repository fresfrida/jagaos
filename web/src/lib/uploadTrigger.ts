/** Lets the mobile bottom nav's raised Upload button (BottomNav.tsx) open
 * the file picker directly when the user is already on /upload, instead
 * of being a dead tap next to the page's own working dropzone (2026-09-23,
 * live regression report item 5 — confirmed: the FAB was a plain <Link>,
 * pure navigation, so tapping it while already on /upload did nothing).
 *
 * A plain window CustomEvent, not a new React Context: BottomNav.tsx and
 * UploadPage.tsx are distant in the tree (rendered from App.tsx and the
 * router respectively, no shared parent worth threading state through)
 * and this is a single fire-and-forget signal, not shared state — a
 * context would be the heavier tool for a smaller job here. */

const TRIGGER_UPLOAD_EVENT = 'jagaos:trigger-upload-picker'

export function triggerUploadPicker(): void {
  window.dispatchEvent(new CustomEvent(TRIGGER_UPLOAD_EVENT))
}

export function onTriggerUploadPicker(handler: () => void): () => void {
  window.addEventListener(TRIGGER_UPLOAD_EVENT, handler)
  return () => window.removeEventListener(TRIGGER_UPLOAD_EVENT, handler)
}
