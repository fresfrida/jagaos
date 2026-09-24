/** A file's lock toggle (2026-09-24, round 14, DECISIONS #86): one tap flips
 * it between "company" (an open lock) and "only me" (a closed lock with a quiet
 * "Only you" label). It is both the indicator and the control, so a personal
 * file is never marked in two places.
 *
 * Shown only where the server says the caller may use it (`can_change_visibility`
 * — the uploader), on the review card, the Company Files card and the file
 * viewer. Presentational: the state and the request are useDocumentVisibility's. */

import { Lock, LockOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'
import { type Visibility } from './opsApi'

export function VisibilityToggle({
  visibility,
  busy,
  error,
  onToggle,
  className,
}: {
  visibility: Visibility
  busy: boolean
  error: string | null
  onToggle: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const personal = visibility === 'only_me'
  const action = personal ? t('ops.visibility.shareWithCompany') : t('ops.visibility.makePrivate')
  return (
    <div className={cn('flex flex-col items-end', className)}>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-label={action}
        title={action}
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-mono uppercase tracking-wide transition-colors disabled:opacity-50',
          personal ? 'bg-canvas text-ink hover:bg-line/50' : 'text-muted hover:bg-canvas hover:text-ink',
        )}
      >
        {personal ? <Lock size={14} aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
        {personal && <span>{t('ops.visibility.onlyYou')}</span>}
      </button>
      {error && (
        <p role="alert" className="mt-1 max-w-[12rem] text-right text-[11px] text-red-700">
          {error === 'uploaderOnly' ? t('ops.visibility.uploaderOnly') : error}
        </p>
      )}
    </div>
  )
}
