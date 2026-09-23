import { useEffect, type ReactNode } from 'react'
import { Button } from './Button'

/** A small modal that gates a destructive action behind an explicit confirm
 * click (2026-09-23, live user feedback) — introduced when "Archive" was
 * renamed to "Delete" (it's functionally permanent from the app's own
 * perspective, DECISIONS #53), since a single unconfirmed click reads very
 * differently once the button says "Delete". Shared by every delete-style
 * action in the app rather than each one building its own modal. */
export function ConfirmDialog({
  open,
  message,
  confirmLabel,
  cancelLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean
  message: ReactNode
  confirmLabel: string
  cancelLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
      onClick={onCancel}
      role="alertdialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-card bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm text-ink">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button size="sm" onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
