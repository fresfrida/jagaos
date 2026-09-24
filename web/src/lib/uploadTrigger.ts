/** Lets the mobile bottom nav's raised Upload button (BottomNav.tsx) — and
 * the "upload a replacement" prompt — bring the Upload page's DOCUMENT / PHOTO
 * choice into view when the person is already on /upload, instead of being a
 * dead tap next to it (2026-09-23, live regression report item 5: the FAB was
 * a plain <Link>, pure navigation, so tapping it while already on /upload did
 * nothing).
 *
 * It used to open the file picker directly. With the two-way choice
 * (2026-09-24, round 12, DECISIONS #78) there is no single picker to open — a
 * tap can't know whether the person has a document or a photo — so it now
 * scrolls to the choice and focuses it, and the person taps one.
 *
 * A plain window CustomEvent, not a new React Context: BottomNav.tsx and
 * UploadPage.tsx are distant in the tree (rendered from App.tsx and the
 * router respectively, no shared parent worth threading state through)
 * and this is a single fire-and-forget signal, not shared state — a
 * context would be the heavier tool for a smaller job here. */

const TRIGGER_UPLOAD_EVENT = 'jagaos:focus-upload-choice'

export function triggerUploadChoice(): void {
  window.dispatchEvent(new CustomEvent(TRIGGER_UPLOAD_EVENT))
}

export function onTriggerUploadChoice(handler: () => void): () => void {
  window.addEventListener(TRIGGER_UPLOAD_EVENT, handler)
  return () => window.removeEventListener(TRIGGER_UPLOAD_EVENT, handler)
}
