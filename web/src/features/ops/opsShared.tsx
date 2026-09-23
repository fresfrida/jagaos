/** Pieces shared by more than one of the ops pages (Upload & Review,
 * Company Files, Calendar) now that each former OpsConsole tab is its own
 * top-level route (2026-09-23, header/nav restructure) — split out of the
 * single OpsConsole.tsx file so a page that only needs, say, DocTypeField
 * doesn't have to import the whole review-card/document-card machinery
 * along with it. Content moved verbatim; nothing here changed behavior. */

import type { TFunction } from 'i18next'
import { File, FileSpreadsheet, FileText, Image as ImageIcon, Mic, MicOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSpeechCaption } from '../../hooks/useSpeechCaption'
import { BUCKETS, DOC_TYPES, opsApi, type DocumentRow } from './opsApi'

// 2026-09-23 (live BM/Tamil i18n audit): BUCKETS/DOC_TYPES are the literal
// DB/API values (bucket filtering, derive_expectations.py's doc_type slug
// matching) — never translate the stored value, only its *display* text,
// same pattern StatusPill below already established for status codes.
// Falls back to the raw value for anything unmapped, so an unmapped value
// never disappears from the UI rather than throwing or rendering blank.
const BUCKET_LABEL_KEY: Record<string, string> = {
  Receivables: 'ops.bucket.receivables',
  Expenses: 'ops.bucket.expenses',
  Statutory: 'ops.bucket.statutory',
  Operations: 'ops.bucket.operations',
  'Memory Lane': 'ops.bucket.memoryLane',
  Miscellaneous: 'ops.bucket.miscellaneous',
}

export function bucketLabel(t: TFunction, bucket: string): string {
  const key = BUCKET_LABEL_KEY[bucket]
  return key ? t(key) : bucket
}

const DOC_TYPE_LABEL_KEY: Record<string, string> = {
  invoice: 'ops.docType.invoice',
  receipt: 'ops.docType.receipt',
  PO: 'ops.docType.po',
  quotation: 'ops.docType.quotation',
  delivery_order: 'ops.docType.deliveryOrder',
  contract: 'ops.docType.contract',
  photo: 'ops.docType.photo',
  other: 'ops.docType.other',
}

export function docTypeLabel(t: TFunction, docType: string): string {
  const key = DOC_TYPE_LABEL_KEY[docType]
  return key ? t(key) : docType
}

// Authoritative list: web/src/features/auth/authApi.ts's Role type / app/
// auth.py's Role Literal — lowercase on the wire, displayed uppercase via
// Badge's own `mono` CSS (text-transform), not via the translated string's
// casing, so a translation can be any case without fighting that class.
const ROLE_LABEL_KEY: Record<string, string> = {
  owner: 'ops.role.owner',
  admin: 'ops.role.admin',
  user: 'ops.role.user',
  viewer: 'ops.role.viewer',
}

export function roleLabel(t: TFunction, role: string): string {
  const key = ROLE_LABEL_KEY[role]
  return key ? t(key) : role
}

// app/rules/statutory.py's Obligation.risk is a plain `str`, not a fixed
// Literal — only "high" is actually produced by any rule today (confirmed
// by grep), "medium"/"low" are here defensively for whenever a rule adds
// them, same "never disappears" fallback as the others above.
const RISK_LABEL_KEY: Record<string, string> = {
  high: 'ops.risk.high',
  medium: 'ops.risk.medium',
  low: 'ops.risk.low',
}

export function riskLabel(t: TFunction, risk: string): string {
  const key = RISK_LABEL_KEY[risk]
  return key ? t(key) : risk
}

/** "Vendor — doc_type", falling back to the description, then doc_type
 * alone, never a raw filename (2026-09-23, Calendar month-grid fix — a
 * confirmed real bug: DatesView's day rows showed raw truncated filenames
 * like "179014556051314855..." instead of anything meaningful). One
 * shared rule so a day's document list and any future caller agree on
 * what "a meaningful label" means, rather than reinventing it inline.
 * **Not yet used by `DocumentCard.tsx`** (Company Files) — that card's
 * header deliberately shows `description` first instead (DECISIONS #52),
 * a separate, already-shipped, already-reasoned-through choice; this
 * matches the Calendar task's own explicit fallback order, not what
 * Company Files currently renders. */
export function formatDocumentLabel(doc: Pick<DocumentRow, 'vendor_name' | 'doc_type' | 'description'>): string {
  if (doc.vendor_name) return doc.doc_type ? `${doc.vendor_name} — ${doc.doc_type}` : doc.vendor_name
  if (doc.description) return doc.description
  if (doc.doc_type) return doc.doc_type
  return ''
}

// The real upload flow only ever produces two values today — confirmed
// against the live local DB (`SELECT DISTINCT media_type FROM document`):
// 'application/pdf' and 'image/jpeg' — because `UploadPage.tsx`'s file
// input is `accept="application/pdf,image/*"`. But `app/graph/ingest.py`
// derives `media_type` from `mimetypes.guess_type(filename)` with no
// server-side allowlist, so a document uploaded directly against the API
// (curl/Swagger, bypassing the frontend's `accept` restriction) could
// carry any type Python's `mimetypes` module recognizes — this map is
// deliberately defensive beyond what the UI currently allows in.
const SPREADSHEET_MEDIA_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
])

/** Small inline file-type icon (2026-09-23, live 375px bug report asked
 * for more than the original image-vs-everything-else split): image,
 * PDF (`FileText` — same meaning `DocumentThumbnail` below already uses
 * for "generic PDF icon", kept consistent rather than introducing a
 * second PDF icon), spreadsheet, and a generic-document fallback (`File`)
 * for anything else, including types this map doesn't specifically know. */
export function DocumentTypeIcon({ mediaType }: { mediaType: string }) {
  const Icon = mediaType.startsWith('image/')
    ? ImageIcon
    : mediaType === 'application/pdf'
      ? FileText
      : SPREADSHEET_MEDIA_TYPES.has(mediaType)
        ? FileSpreadsheet
        : File
  return <Icon size={14} className="shrink-0 text-muted" aria-hidden="true" />
}

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

/** Single-select pill/button group, replacing a `<select>` for a small
 * fixed vocabulary (2026-09-23, live user feedback: "should be buttons as
 * they are easier to select than drop down" — said about Bucket, applied
 * here generically since doc_type is the same shape of field). An
 * optional `clearLabel` renders one extra pill that sets the value back
 * to `""` (unset); omit it for a field that must always hold a value.
 * `labels` lets one specific option's button text differ from its raw
 * value (used for doc_type's "(legacy)" suffix below) without needing a
 * second, parallel options list. */
export function PillPicker({
  options,
  value,
  disabled,
  onChange,
  clearLabel,
  labels,
}: {
  options: readonly string[]
  value: string
  disabled: boolean
  onChange: (value: string) => void
  clearLabel?: string
  labels?: Record<string, string>
}) {
  const pillClass = (active: boolean) =>
    `rounded-md border px-2.5 py-1 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
      active ? 'border-ink bg-ink text-white' : 'border-line bg-white text-muted hover:border-ink/40 hover:text-ink'
    }`
  return (
    <div className="flex flex-wrap gap-1.5" role="group">
      {clearLabel !== undefined && (
        <button type="button" disabled={disabled} onClick={() => onChange('')} className={pillClass(value === '')}>
          {clearLabel}
        </button>
      )}
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt)}
          aria-pressed={value === opt}
          className={pillClass(value === opt)}
        >
          {labels?.[opt] ?? opt}
        </button>
      ))}
    </div>
  )
}

/** doc_type as a button group, hard-locked to DOC_TYPES — EXCEPT the
 * statutory lane, which stays free text (2026-09-22, DECISIONS #45:
 * category fields are a fixed choice, name fields are free text;
 * statutory's doc_type is a name — "ACRA Certificate of Incorporation" —
 * matched against expectation slugs by
 * derive_expectations.py::_matches_doc_type, not a closed vocabulary, so
 * forcing it into DOC_TYPES would break gap matching). Shared by
 * ReviewQueueCard and DocumentCard so the lane-based branch exists in
 * exactly one place. `className` only applies to the statutory `<input>`
 * — the button-group branch (2026-09-23, same live feedback that moved
 * Bucket off a dropdown) lays itself out with `PillPicker` instead of a
 * single-control class string. A current value outside DOC_TYPES (a
 * pre-rework document, classified before this vocabulary existed) gets
 * its own "(legacy)" pill instead of silently vanishing or being coerced
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
  // Pill *text* is translated (docTypeLabel); the *value* passed to
  // onChange/saved is always the raw DOC_TYPES string underneath — same
  // "translate display only, never the stored value" rule as bucketLabel.
  const labels: Record<string, string> = Object.fromEntries(DOC_TYPES.map((dt) => [dt, docTypeLabel(t, dt)]))
  if (isLegacyValue) labels[value] = t('ops.docType.legacySuffix', { value })
  return (
    <div className="mt-1">
      <PillPicker
        options={isLegacyValue ? [value, ...DOC_TYPES] : [...DOC_TYPES]}
        value={value}
        disabled={disabled}
        onChange={onChange}
        clearLabel="—"
        labels={labels}
      />
    </div>
  )
}

/** Bucket as a translated button group over the fixed `BUCKETS` taxonomy
 * (2026-09-23, live BM/Tamil i18n audit — `DocumentCard.tsx` and
 * `ReviewQueueCard.tsx` each rendered `<PillPicker options={BUCKETS}>`
 * directly, so the pill *text* was always the raw English value even in
 * BM/Tamil). Mirrors `DocTypeField`'s shape/translate-display-only rule so
 * both call sites read from one place instead of building their own
 * `labels` map. */
export function BucketField({
  value,
  disabled,
  onChange,
  clearLabel,
}: {
  value: string
  disabled: boolean
  onChange: (value: string) => void
  clearLabel?: string
}) {
  const { t } = useTranslation()
  const labels: Record<string, string> = Object.fromEntries(BUCKETS.map((b) => [b, bucketLabel(t, b)]))
  return (
    <PillPicker
      options={BUCKETS}
      value={value}
      disabled={disabled}
      onChange={onChange}
      clearLabel={clearLabel}
      labels={labels}
    />
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

// 2026-09-23, live user question ("unsure what is 'Filed' status shown
// for... is it really necessary to be shown"): a badge earns its place by
// telling a business owner something needs attention (needs review,
// quarantined) or explaining an otherwise-surprising state (open,
// missing). The default "processed fine, nothing to do" outcome doesn't —
// showing nothing here is itself informative (no badge = nothing wrong),
// so `filed`/`processed` render no pill at all rather than a
// pipeline-status word most users won't recognize. Every other status
// this map knows is exceptional enough to keep showing.
const STATUSES_WITHOUT_A_BADGE = new Set(['filed', 'processed'])

export function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation()
  if (STATUSES_WITHOUT_A_BADGE.has(status)) return null
  const labelKey = STATUS_LABEL_KEY[status]
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-mono uppercase tracking-wide ${STATUS_TONE[status] ?? 'bg-canvas text-muted'}`}>
      {labelKey ? t(labelKey) : status}
    </span>
  )
}
