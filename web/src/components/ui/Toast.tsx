import { CheckCircle2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'

/** 2026-09-24 — no toast/notification primitive existed anywhere in this
 * codebase before this (confirmed by search). A local hook + a small
 * presentational component, not a global toast queue: today there is
 * exactly one call site (the upload success toast, UploadPage.tsx) and
 * this project's own coding rule is "no heavy abstraction without real
 * duplication to remove" — a second caller can reuse `useToast` the same
 * way without needing a shared provider/context, since each call site
 * only ever needs to know about its own toast. */

export type ToastTone = 'success' | 'warning' | 'error'

export interface ToastState {
  message: string
  tone: ToastTone
}

const AUTO_DISMISS_MS = 4000

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    setToast({ message, tone })
  }, [])

  const dismissToast = useCallback(() => setToast(null), [])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), AUTO_DISMISS_MS)
    return () => window.clearTimeout(id)
  }, [toast])

  return { toast, showToast, dismissToast }
}

const TONE_CLASS: Record<ToastTone, string> = {
  success: 'border-ink/10 bg-ink text-white',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-800',
}

/** Auto-dismissing, non-blocking — doesn't stop the reviewer from doing
 * anything else (`role="status"`/`aria-live="polite"`, not an alertdialog
 * like ConfirmDialog). Fixed above the mobile bottom nav (`bottom-20`,
 * BottomNav.tsx is `fixed inset-x-0 bottom-0`) so it never sits under it;
 * `sm:bottom-6` once that nav is hidden at desktop widths. */
export function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  const { t } = useTranslation()
  if (!toast) return null
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-sm items-center justify-between gap-3 rounded-card border px-4 py-3 text-[13px] shadow-lg sm:bottom-6',
        TONE_CLASS[toast.tone],
      )}
    >
      <span className="flex items-center gap-2">
        {toast.tone === 'success' && <CheckCircle2 size={16} className="shrink-0" aria-hidden="true" />}
        {toast.message}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-control p-0.5 opacity-70 hover:opacity-100"
        aria-label={t('common.buttons.dismiss')}
      >
        <X size={14} />
      </button>
    </div>
  )
}
