/** The "Only me" choice on the Upload page (2026-09-24, round 13, DECISIONS
 * #85) — a personal file only the uploader can ever see: not admins, not the
 * owner. Deliberately a small, secondary control under the DOCUMENT / PHOTO
 * fork, not a third card: that fork is the loud either/or; this is an optional
 * modifier that applies to whichever it is, including a multi-page document.
 *
 * Presentational. A native checkbox, so it is keyboard and screen-reader
 * accessible without extra work; the hint is part of its label so what it
 * promises is read out with it. */

import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'

export function UploadVisibility({
  onlyMe,
  disabled,
  onChange,
}: {
  onlyMe: boolean
  disabled: boolean
  onChange: (onlyMe: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <label
      className={cn(
        'mt-4 flex cursor-pointer items-start gap-2.5 rounded-control border px-3 py-2 text-[13px] transition-colors',
        onlyMe ? 'border-ink bg-canvas' : 'border-line',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <input
        type="checkbox"
        checked={onlyMe}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 font-medium text-ink">
          <Lock size={13} aria-hidden="true" /> {t('ops.upload.visibility.label')}
        </span>
        <span className="block text-[12px] text-muted">{t('ops.upload.visibility.hint')}</span>
      </span>
    </label>
  )
}
