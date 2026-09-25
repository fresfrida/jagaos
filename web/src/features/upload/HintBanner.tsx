import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** Says which checklist item an upload is being started for, with a way to drop it
 * (2026-09-24, round 16). A hint, not a requirement: clearing it uploads exactly as
 * before, and whatever gets uploaded is still classified from its own text. */
export function HintBanner({ label, onClear }: { label: string; onClear: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-card border border-sage bg-canvas px-3 py-2.5 text-[14px] text-ink" data-testid="upload-hint">
      <p className="min-w-0">{t('ops.upload.hint.filingFor', { label })}</p>
      <button
        type="button"
        onClick={onClear}
        aria-label={t('ops.upload.hint.clear')}
        className="shrink-0 rounded-control p-1 text-muted hover:bg-white hover:text-ink"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
