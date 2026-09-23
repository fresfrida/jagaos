/** Pieces shared by more than one of the ops pages (Upload & Review,
 * Company Files, Calendar) now that each former OpsConsole tab is its own
 * top-level route (2026-09-23, header/nav restructure) — split out of the
 * single OpsConsole.tsx file so a page that only needs, say, DocTypeField
 * doesn't have to import the whole review-card/document-card machinery
 * along with it. Content moved verbatim; nothing here changed behavior. */

import { Mic, MicOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSpeechCaption } from '../../hooks/useSpeechCaption'
import { DOC_TYPES, opsApi } from './opsApi'

// 2026-09-22 (DECISIONS #45): shared <datalist> id both DocumentCard's and
// ReviewQueueCard's vendor_name <input> point at via list=. Each page that
// renders one of those cards renders its own <datalist> with this id
// (pages are now separate mounts, so there's no single shared root to hang
// one instance off of) — a <datalist> has no visual footprint, so nothing
// breaks by there being one per page rather than one per app.
export const VENDOR_NAMES_DATALIST_ID = 'ops-vendor-names'

/** "confidence: 30%", not "(0.30)" — a raw decimal next to a field reads
 * like a mysterious score; the labeled percentage reads as what it is
 * (2026-09-22). The one place this renders, so every field agrees. */
export function formatConfidence(confidence: number): string {
  return `confidence: ${(confidence * 100).toFixed(0)}%`
}

/** Fetches a document's bytes once and exposes them as a local blob: URL,
 * with cleanup on unmount/change. <img>/<embed>/thumbnails can't carry
 * the session's bearer token, so every source view (the review card's
 * inline preview, the Documents-list thumbnail, the viewer modal) fetches
 * the bytes itself rather than pointing straight at the API URL — this is
 * that fetch-and-object-URL dance, pulled out once a third caller needed
 * it (2026-09-22). `enabled=false` skips the fetch entirely (the
 * thumbnail never fetches a PDF just to show a generic icon). */
export function useDocumentBlobUrl(documentId: number, enabled = true): { blobUrl: string | null; failed: boolean } {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let url: string | null = null
    setBlobUrl(null)
    setFailed(false)
    opsApi
      .fetchDocumentFile(documentId)
      .then((blob) => {
        if (cancelled) return
        url = URL.createObjectURL(blob)
        setBlobUrl(url)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [documentId, enabled])

  return { blobUrl, failed }
}

export const FIELD_CLASS =
  'block h-9 w-full rounded-control border border-line bg-white px-2.5 text-[13px] text-ink outline-none focus:border-ink disabled:bg-canvas disabled:text-muted'

/** doc_type as a dropdown, hard-locked to DOC_TYPES — EXCEPT the statutory
 * lane, which stays free text (2026-09-22, DECISIONS #45: category fields
 * are dropdowns, name fields are free text; statutory's doc_type is a
 * name — "ACRA Certificate of Incorporation" — matched against
 * expectation slugs by derive_expectations.py::_matches_doc_type, not a
 * closed vocabulary, so forcing it into DOC_TYPES would break gap
 * matching). Shared by ReviewQueueCard and DocumentCard so the lane-based
 * branch exists in exactly one place; `className` is supplied by the
 * caller rather than fixed here since the two cards' surrounding layout
 * differs (one sits under a visible `<label>` and needs `mt-1`, the other
 * doesn't). A current value outside DOC_TYPES (a pre-rework document,
 * classified before this vocabulary existed) gets its own "(legacy)"
 * option instead of silently vanishing from the dropdown or being coerced
 * to something else on save. */
export function DocTypeField({
  lane,
  value,
  disabled,
  onChange,
  className,
}: {
  lane: string | null
  value: string
  disabled: boolean
  onChange: (value: string) => void
  className: string
}) {
  const { t } = useTranslation()
  if (lane === 'statutory') {
    return <input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={className} />
  }
  const isLegacyValue = value !== '' && !(DOC_TYPES as readonly string[]).includes(value)
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">—</option>
      {isLegacyValue && <option value={value}>{t('ops.docType.legacySuffix', { value })}</option>}
      {DOC_TYPES.map((dt) => (
        <option key={dt} value={dt}>{dt}</option>
      ))}
    </select>
  )
}

/** Tap-to-talk caption button next to a picture-lane document's
 * Description field (2026-09-23) — the gateway this hackathon provides
 * cannot see images at all (MDs/GAPS.md §8), so a photo's description has
 * no automatic source; speaking one is faster than typing on a phone,
 * which is where most photos get uploaded from. Renders nothing when the
 * browser has no Web Speech API — the caller's existing plain text input
 * is already the fallback (no separate fallback UI needed). */
export function VoiceCaptionButton({ onCaption, disabled }: { onCaption: (text: string) => void; disabled: boolean }) {
  const { t } = useTranslation()
  const { supported, listening, start, stop } = useSpeechCaption(onCaption)
  if (!supported) return null
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => (listening ? stop() : start())}
      aria-label={listening ? t('ops.voiceCaption.stopRecording') : t('ops.voiceCaption.recordCaption')}
      title={listening ? t('ops.voiceCaption.stopRecording') : t('ops.voiceCaption.recordCaption')}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-line disabled:text-muted disabled:opacity-60 ${listening ? 'border-red-300 bg-red-50 text-red-600' : 'text-muted hover:border-ink/40 hover:text-ink'}`}
    >
      {listening ? <MicOff size={14} /> : <Mic size={14} />}
    </button>
  )
}

/** "Is this a picture, not a document?" as an after-upload correction —
 * grouped with the other document-level metadata fields (2026-09-23),
 * not a separate special control, matching the upload-time toggle it
 * mirrors. One-directional by design (DocumentEditRequest's docstring,
 * app/models.py): once `locked` (the document's saved lane is already
 * 'memory'), there's nothing left to correct, so the checkbox is shown
 * checked and disabled rather than implying an un-correction this doesn't
 * support. */
export function PictureToggleField({
  checked,
  locked,
  disabled,
  onChange,
}: {
  checked: boolean
  locked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <label className="flex flex-col gap-1 text-[12px] text-muted sm:col-span-3">
      <span className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled || locked}
          onChange={(e) => onChange(e.target.checked)}
        />
        {t('ops.pictureToggle.label')}
        {locked && <span className="text-[11px] text-muted">{t('ops.pictureToggle.alreadyMarked')}</span>}
      </span>
      {checked && !locked && (
        <span className="text-[11px] text-muted">{t('ops.pictureToggle.reducesAccuracy')}</span>
      )}
    </label>
  )
}

const STATUS_TONE: Record<string, string> = {
  filed: 'text-sage-ink bg-sage/15',
  processed: 'text-sage-ink bg-sage/15',
  needs_review: 'text-amber-800 bg-amber-100',
  quarantined: 'text-red-800 bg-red-100',
  missing: 'text-muted bg-canvas',
  satisfied: 'text-sage-ink bg-sage/15',
  open: 'text-amber-800 bg-amber-100',
  archived: 'text-muted bg-canvas',
}

// Maps a raw status code (as returned by the backend, e.g. "needs_review")
// to its translation key under ops.status.* — falls back to the raw code
// for any status this map doesn't know about, so an unmapped backend value
// never disappears from the UI.
const STATUS_LABEL_KEY: Record<string, string> = {
  filed: 'ops.status.filed',
  processed: 'ops.status.processed',
  needs_review: 'ops.status.needsReview',
  quarantined: 'ops.status.quarantined',
  missing: 'ops.status.missing',
  satisfied: 'ops.status.satisfied',
  open: 'ops.status.open',
  archived: 'ops.status.archived',
}

export function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation()
  const labelKey = STATUS_LABEL_KEY[status]
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-mono uppercase tracking-wide ${STATUS_TONE[status] ?? 'bg-canvas text-muted'}`}>
      {labelKey ? t(labelKey) : status}
    </span>
  )
}
