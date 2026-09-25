/** Opens the demo-account picker from anywhere (2026-09-25, DECISIONS #106). The signed-out header's Get Started, the
 * landing page's two buttons and the footer's Get Started all open the SAME dialog, so it is mounted once
 * (features/auth/DemoPickerHost.tsx) and they only signal it. Same pattern, and the same reason, as lib/uploadTrigger.ts: a
 * plain window CustomEvent, because the buttons and the dialog are siblings under App with nothing else in common and this
 * is one fire-and-forget signal, not shared state. */

const OPEN_DEMO_PICKER_EVENT = 'jagaos:open-demo-picker'

export function openDemoPicker(): void {
  window.dispatchEvent(new CustomEvent(OPEN_DEMO_PICKER_EVENT))
}

export function onOpenDemoPicker(handler: () => void): () => void {
  window.addEventListener(OPEN_DEMO_PICKER_EVENT, handler)
  return () => window.removeEventListener(OPEN_DEMO_PICKER_EVENT, handler)
}
