import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from './Button'

/** A confirmation for something that cannot be undone, where a click is not enough (2026-09-25, round 20, item 6,
 * DECISIONS #99): the person has to TYPE what they are deleting. ConfirmDialog is a message and two buttons, right
 * for the app's soft deletes; this is for the hard one (a private file is deleted for good), where a tap on the
 * wrong card must not be able to do it. The confirm button stays off until what was typed equals `expected`
 * exactly, and the server checks the same text again, so this friction is not just cosmetic.
 *
 * `expected` is shown in full, in a block that breaks anywhere, so a long file name can be read and typed.
 * Escape and the backdrop cancel; Enter confirms only when the text matches. */
export function TypedConfirmDialog({
  open,
  message,
  prompt,
  expected,
  inputLabel,
  confirmLabel,
  cancelLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean
  message: ReactNode
  /** The line above the field: "Type the file name to confirm". */
  prompt: string
  expected: string
  inputLabel: string
  confirmLabel: string
  cancelLabel: string
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const promptId = useId()
  const matches = typed === expected

  useEffect(() => {
    if (!open) return
    setTyped('') // every opening starts empty, so a second delete is never one keystroke from done
    input.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (matches && !busy) onConfirm()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={onCancel} role="alertdialog" aria-modal="true" aria-describedby={promptId}>
      <form className="w-full max-w-sm rounded-card bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <p className="text-sm text-ink">{message}</p>
        <p id={promptId} className="mt-4 text-[14px] text-muted">{prompt}</p>
        <code className="mt-1.5 block break-all rounded-control bg-canvas px-3 py-2 font-mono text-[13px] text-ink" data-testid="typed-confirm-expected">{expected}</code>
        <input
          ref={input}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          aria-label={inputLabel}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={busy}
          className="mt-3 h-10 w-full rounded-control border border-line bg-white px-3 text-[15px] text-ink outline-none focus:border-ink"
        />
        {error && <p role="alert" className="mt-2 text-[13px] text-red-700">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button type="submit" size="sm" disabled={!matches || busy} className="disabled:cursor-not-allowed disabled:opacity-50">
            {confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  )
}
