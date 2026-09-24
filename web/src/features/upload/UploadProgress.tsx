/** The moment between choosing a file and the review queue (2026-09-24, round 16,
 * item 3), replacing a line of grey "Uploading..." text. A ring that spins around
 * a document mark, the filename under it (cut in the middle so the start and the
 * extension both show), and a line of narration that moves on every few seconds
 * so a slow reading of a big scan does not look stuck.
 *
 * The narration is honest about being a progress hint, not a measurement: the
 * server reports no percentage, so the lines simply advance and HOLD on the last
 * one ("Almost filed") if the work runs long, rather than looping back to "Reading
 * your document" as if it had started over. A screen reader hears one plain
 * "Uploading <name>" announcement; the changing lines are visual only, so it is not
 * interrupted every few seconds. Presentational: it is told what is uploading. */

import { FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileName } from '../../components/ui/FileName'

export const NARRATION_KEYS = [
  'ops.upload.progress.reading',
  'ops.upload.progress.details',
  'ops.upload.progress.almost',
] as const

export const NARRATION_STEP_MS = 2800

/** Index of the narration line to show after `elapsedMs`: one step at a time, then it holds on the last. */
export function narrationIndex(elapsedMs: number, stepMs: number = NARRATION_STEP_MS, count: number = NARRATION_KEYS.length): number {
  return Math.min(Math.floor(Math.max(elapsedMs, 0) / stepMs), count - 1)
}

function useNarrationIndex(): number {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const timer = window.setInterval(() => {
      const next = narrationIndex(Date.now() - started)
      setIndex(next)
      if (next === NARRATION_KEYS.length - 1) window.clearInterval(timer)
    }, 500)
    return () => window.clearInterval(timer)
  }, [])
  return index
}

export function UploadProgress({ name, pages }: { name: string; pages?: number }) {
  const { t } = useTranslation()
  const line = NARRATION_KEYS[useNarrationIndex()] ?? NARRATION_KEYS[0]

  return (
    <div className="flex flex-col items-center px-4 py-8 text-center" role="status" data-testid="upload-progress">
      <span className="sr-only">{t('ops.upload.progress.announce', { name })}</span>
      <div className="relative flex h-16 w-16 items-center justify-center" aria-hidden="true">
        <div className="absolute inset-0 animate-spin rounded-full border-[3px] border-line border-t-ink" />
        <FileText size={22} strokeWidth={1.75} className="text-ink" />
      </div>
      <p className="mt-4 max-w-full text-sm font-medium text-ink" aria-hidden="true">
        <FileName name={name} max={32} />
      </p>
      {pages !== undefined && pages > 1 && (
        <p className="mt-0.5 text-[12px] text-muted" aria-hidden="true">{t('ops.upload.progress.pages', { count: pages })}</p>
      )}
      <p className="mt-1 h-5 text-[13px] text-muted" aria-hidden="true" data-testid="upload-narration">{t(line)}</p>
    </div>
  )
}
