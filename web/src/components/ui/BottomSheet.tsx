import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The one bottom sheet (2026-09-24, round 16, items 3 and 10c): a panel that
 * slides up from the bottom edge over a dimmed page. Built once and shared by
 * everything that needs "a short question or choice, then out of the way" — the
 * demo picker, the post-rejection prompt, the universal Upload choice reachable
 * from every page, the prefill confirmation in Company Settings, and Only me's
 * naming step.
 *
 * On a phone it is anchored to the bottom edge, with a grab handle. From `sm` up
 * (DECISIONS #111) the same panel rests in the CENTRE of the screen, with all four
 * corners rounded and no handle: anchored to the bottom of a tall desktop window
 * a short panel read as hanging low. The slide-in motion is unchanged.
 *
 * It is a dialog: it takes focus when it opens, keeps Tab inside itself, closes on
 * Escape, on the dimmed area, and on the handle's close button, and gives focus
 * back to whatever had it. The page behind does not scroll while it is open.
 * Motion is a plain slide; the app-wide MotionConfig turns it into an instant
 * appearance for anyone who asked their system for reduced motion.
 *
 * Presentational: it holds no state beyond focus. `open` and `onClose` are the
 * caller's, and what goes inside is the caller's `children`. `title` is the
 * accessible name and the visible heading. */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  // Read through a ref so a parent that passes a fresh callback every render does
  // not re-run the effect below (which would steal focus back to the panel each time).
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) {
        event.preventDefault()
        return
      }
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      returnTo?.focus()
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          // z-60: above a toast (z-50), which is fixed to the same edge and would otherwise sit on top of the sheet's text
          className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/50 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => onCloseRef.current()}
          data-testid="bottom-sheet-backdrop"
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="w-full max-w-lg rounded-t-card bg-white px-5 pt-3 shadow-xl outline-none sm:rounded-card sm:pt-5"
            style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'tween', duration: 0.22, ease: 'easeOut' }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden="true" />
            <div className="flex items-start justify-between gap-3">
              <h2 id={titleId} className="text-base font-semibold text-ink">{title}</h2>
              <button
                type="button"
                onClick={() => onCloseRef.current()}
                aria-label={t('common.buttons.close')}
                className="-mr-1.5 -mt-1 shrink-0 rounded-control p-1.5 text-muted hover:bg-canvas hover:text-ink"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            <div className="mt-3">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
