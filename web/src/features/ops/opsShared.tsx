/** Pieces shared by more than one of the ops pages (Upload & Review,
 * Company Files, Calendar) now that each former OpsConsole tab is its own
 * top-level route (2026-09-23, header/nav restructure) — split out of the
 * single OpsConsole.tsx file so a page that only needs, say, DocTypeField
 * doesn't have to import the whole review-card/document-card machinery
 * along with it. Content moved verbatim; nothing here changed behavior. */

import type { TFunction } from 'i18next'
import { File, FileSpreadsheet, FileText, Image as ImageIcon, Lock, Mic, MicOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSpeechCaption } from '../../hooks/useSpeechCaption'
import { BUCKETS, DOC_TYPES, opsApi, type DocumentRow, type ReviewReason } from './opsApi'

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
  Contracts: 'ops.bucket.contracts',
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

// 2026-09-23 (live regression report, items 7/8/10b): app/graph/verify.py
// now returns structured {code, params} reasons instead of a pre-joined
// English sentence — this is the frontend half, the same "translated
// display, stable code underneath, never-disappears fallback" shape as
// bucketLabel/docTypeLabel above. Two sentinel shapes read specially
// (mirrored from verify.py's own logic, kept in sync by hand): an empty
// array is "no issues found"; a lone file_missing entry is the distinct
// red headline — both checked by the caller (ReviewQueueCard.tsx), not
// here, since they also drive styling, not just text.
const REASON_LABEL_KEY: Record<string, string> = {
  injection_suspected: 'ops.review.reasons.injectionSuspected',
  // 2026-09-23 (DECISIONS #68): distinct from injection_suspected above —
  // that's the soft, model-only-flagged case (still reviewable, Accept
  // available). This is the hard, regex-corroborated quarantine — more
  // severe, no Accept (ReviewQueueCard.tsx's isInjectionBlocked hides it),
  // only Delete/Reject. Plain language, no "quarantine"/jargon.
  injection_suspected_blocked: 'ops.review.reasons.injectionSuspectedBlocked',
  extraction_error: 'ops.review.reasons.extractionError',
  zero_amounts: 'ops.review.reasons.zeroAmounts',
  gst_mismatch: 'ops.review.reasons.gstMismatch',
  total_mismatch: 'ops.review.reasons.totalMismatch',
  amounts_not_in_text: 'ops.review.reasons.amountsNotInText',
  missing_required_fields: 'ops.review.reasons.missingRequiredFields',
  missing_arithmetic_fields: 'ops.review.reasons.missingArithmeticFields',
  description_signals_problem: 'ops.review.reasons.descriptionSignalsProblem',
  // 2026-09-23 (DECISIONS #68): reconnected app/graph/verify.py::
  // _check_classify_confidence's contribution (items 7/8 had removed it,
  // which left an unreadable document showing nothing — "No issues
  // found" — actively misleading). New code, no percentage/confidence
  // param, unlike the old one this replaces.
  could_not_read_document: 'ops.review.reasons.couldNotReadDocument',
}

/** review_item.question is now JSON-encoded ReviewReason[], not a
 * sentence (2026-09-23) — parses defensively (an unparseable/legacy value
 * degrades to "no issues found" rather than crashing the card). */
export function parseReviewReasons(question: string): ReviewReason[] {
  try {
    const parsed: unknown = JSON.parse(question)
    return Array.isArray(parsed) ? (parsed as ReviewReason[]) : []
  } catch {
    return []
  }
}

export function isFileMissingReason(reasons: ReviewReason[]): boolean {
  return reasons.length === 1 && reasons[0]?.code === 'file_missing'
}

/** 2026-09-23 (DECISIONS #68): a hard-quarantined document's only review
 * reason — no extraction was ever presented as trustworthy for it
 * (`proposed_json` is `"{}"`, `app/graph/verify.py`), so there is nothing
 * for Accept to confirm; ReviewQueueCard.tsx hides that button and shows
 * only Delete/Reject when this is true. */
export function isInjectionBlockedReason(reasons: ReviewReason[]): boolean {
  return reasons.length === 1 && reasons[0]?.code === 'injection_suspected_blocked'
}

// 2026-09-24 (round 11): two reasons that describe the same underlying
// problem — key = the more technical signal, value = the plainer one that
// already covers it. When both are present only the plain one is shown.
// Display-only: verify.py keeps emitting both on purpose (two independent
// detectors — the model's own low confidence, and its description matching
// a problem phrase — is defense in depth, DECISIONS #67/#68), and the
// stored review_item still records both.
const COVERED_BY: Record<string, string> = {
  description_signals_problem: 'could_not_read_document',
}

// Reasons whose translated text is already a complete sentence, not a
// fragment meant to follow "Please confirm:" (same reasoning as file_missing
// and injection_suspected_blocked above) — shown bare when they are the
// only reason.
const STANDALONE_WHEN_ALONE = new Set(['could_not_read_document'])

export function dedupeReasons(reasons: ReviewReason[]): ReviewReason[] {
  const present = new Set(reasons.map((r) => r.code))
  return reasons.filter((r) => {
    const coveredBy = COVERED_BY[r.code]
    return !(coveredBy && present.has(coveredBy))
  })
}

/** Whether to offer Edit on a document. Only an explicit `false` from the
 * server hides it: the frontend deploys on every push but the backend only
 * when redeployed, so against an older backend `can_edit` is simply absent —
 * and "absent" must fall back to the role check (the server still enforces
 * the real rule and a refused save shows a translated message), not hide
 * Edit from every role, which is what `roleCanEdit && doc.can_edit` did. */
export function documentIsEditable(roleCanEdit: boolean, doc: Pick<DocumentRow, 'can_edit'>): boolean {
  return roleCanEdit && doc.can_edit !== false
}

/** verify.py joins raw extract-field names ("vendor, issued_on") into one
 * param; translate each through the same label table the Extracted fields
 * grid uses, so a Malay sentence never carries English field names. */
function translateFieldNames(t: TFunction, joined: string): string {
  return joined
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => fieldLabel(t, name))
    .join(', ')
}

/** One reason as a sentence fragment. Only params that are language-neutral
 * (amounts) or translated here (field names) are interpolated — the
 * detector's matched English word and extract.py's raw validation error are
 * deliberately not, they would put English inside a Malay/Chinese/Tamil
 * sentence (both still ride along in the stored params, for debugging). */
function reasonSentence(t: TFunction, reason: ReviewReason): string {
  const key = REASON_LABEL_KEY[reason.code]
  if (!key) return reason.code
  if (reason.code === 'missing_required_fields') {
    return t(key, { fields: translateFieldNames(t, reason.params.fields ?? '') })
  }
  return t(key, reason.params)
}

function capitalizeFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1)
}

export type ReasonDisplay =
  | { layout: 'text'; text: string }
  | { layout: 'list'; heading: string; items: string[] }

/** What a review card's flagged-reason block should show, built from
 * translated per-reason text — never a raw code, and never a stored English
 * sentence (this backend has no notion of the caller's language, so a
 * ready-made sentence could never actually be translated). A single reason
 * reads as one sentence; several distinct reasons stack as a list instead of
 * one run-on joined with semicolons. */
export function reasonDisplay(t: TFunction, reasons: ReviewReason[]): ReasonDisplay {
  if (isFileMissingReason(reasons)) return { layout: 'text', text: t('ops.review.reasons.fileMissing') }
  // 2026-09-23 (DECISIONS #68): same reasoning as file_missing above —
  // its own translated string is already a complete, standalone
  // statement ("...Delete it, or upload a different copy."), not a
  // fragment meant to follow "Please confirm:" (there's nothing to
  // confirm when Accept isn't even offered — caught live, the wrapped
  // version read as nonsensical).
  if (isInjectionBlockedReason(reasons)) return { layout: 'text', text: t('ops.review.reasons.injectionSuspectedBlocked') }
  if (reasons.length === 0) return { layout: 'text', text: t('ops.review.reasons.clean') }

  const shown = dedupeReasons(reasons)
  const [only] = shown
  if (shown.length === 1 && only) {
    const sentence = reasonSentence(t, only)
    return {
      layout: 'text',
      text: STANDALONE_WHEN_ALONE.has(only.code) ? sentence : t('ops.review.reasons.prefix', { reasons: sentence }),
    }
  }
  return {
    layout: 'list',
    heading: t('ops.review.reasons.prefixList'),
    items: shown.map((r) => capitalizeFirst(reasonSentence(t, r))),
  }
}

// The generic "Extracted fields" grid (ReviewQueueCard.tsx) renders every
// extract_result key it's handed — a mix of InvoiceFields' and
// StatutoryFields' (app/models.py) field names, since which lane produced
// the data decides which set shows up. Raw dict keys ("gst_reg_no") used
// to print as-is regardless of language (2026-09-23, i18n audit, item
// 10a) — translated display only, same never-disappears fallback as
// bucketLabel/docTypeLabel above; the field NAME sent back on save is
// always the raw key, unaffected by this.
const FIELD_LABEL_KEY: Record<string, string> = {
  vendor: 'ops.review.fieldLabel.vendor',
  gst_reg_no: 'ops.review.fieldLabel.gstRegNo',
  invoice_no: 'ops.review.fieldLabel.invoiceNo',
  issued_on: 'ops.review.fieldLabel.issuedOn',
  subtotal: 'ops.review.fieldLabel.subtotal',
  // 2026-09-24 (item 10): `gst` renamed to `tax` — a generic label, not
  // Singapore-specific, since this field now holds whatever tax is on the
  // invoice (GST, PPN, VAT...). `tax_label` is new: what the document
  // itself calls that tax, verbatim ("GST", "PPN 11%") — this is where
  // "GST" as a word ever appears now, only when a document actually says
  // so, never as a hardcoded universal default the way the old `gst`
  // label was.
  tax: 'ops.review.fieldLabel.tax',
  tax_label: 'ops.review.fieldLabel.taxLabel',
  // 2026-09-24 (item 9): no currency field existed before this at all.
  currency: 'ops.review.fieldLabel.currency',
  total: 'ops.review.fieldLabel.total',
  doc_type: 'ops.review.fieldLabel.docType',
  reference_no: 'ops.review.fieldLabel.referenceNo',
  due_on: 'ops.review.fieldLabel.dueOn',
  subject: 'ops.review.fieldLabel.subject',
  // 2026-09-24 (round 12, DECISIONS #79): CompanyProfileFields
  // (app/models.py) — the ACRA business profile's own extraction shape.
  company_name: 'ops.review.fieldLabel.companyName',
  uen: 'ops.review.fieldLabel.uen',
  fye_month: 'ops.review.fieldLabel.fyeMonth',
  fye_day: 'ops.review.fieldLabel.fyeDay',
  gst_registered: 'ops.review.fieldLabel.gstRegistered',
  registered_address: 'ops.review.fieldLabel.registeredAddress',
}

export function fieldLabel(t: TFunction, name: string): string {
  const key = FIELD_LABEL_KEY[name]
  return key ? t(key) : name
}

// A field extracted as a date (app/models.py's InvoiceFields.issued_on,
// StatutoryFields.issued_on/due_on — Provenance[date]) — the closed,
// hand-kept-in-sync set of extract_result keys that get the DD/MM/YYYY
// masked input below instead of a plain text box (2026-09-23, live
// regression report item 4).
export const DATE_FIELD_NAMES = new Set(['issued_on', 'due_on'])

// A field extracted as a yes/no (app/models.py's CompanyProfileFields.
// gst_registered — Provenance[bool | None]) — rendered as a Yes / No / Not
// stated select instead of a text box showing the words "true"/"false", and
// sent back as a real boolean (or null for "not stated"), not a string.
export const BOOLEAN_FIELD_NAMES = new Set(['gst_registered'])

// A native <input type="date">'s DISPLAYED format is controlled by the
// browser/OS locale, not app code — HTML5 only guarantees the underlying
// value is ISO YYYY-MM-DD, so it can't be forced to always show
// DD/MM/YYYY (Singapore's convention) across every browser/OS. Chosen
// instead: a plain masked text input, parsed/validated on the way in,
// ISO stored underneath — the real, working option, not the one with an
// unfixable cross-browser display gap.
export function isoToDmy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

/** null when `dmy` isn't (yet) a complete, valid DD/MM/YYYY string — the
 * caller keeps showing what the user typed either way, only committing
 * the parsed ISO value once it's complete, so typing "1" then "15" then
 * "15/0" etc. doesn't fight the user mid-keystroke. */
export function dmyToIso(dmy: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy.trim())
  if (!m) return null
  const [, d, mo, y] = m
  return `${y}-${mo}-${d}`
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
export function formatDocumentLabel(
  doc: Pick<DocumentRow, 'vendor_name' | 'doc_type' | 'description'>,
  language: string,
): string {
  if (doc.vendor_name) return doc.doc_type ? `${doc.vendor_name} · ${doc.doc_type}` : doc.vendor_name
  const description = descriptionFor(doc.description, language)
  if (description) return description
  if (doc.doc_type) return doc.doc_type
  return ''
}

// 2026-09-24 (items 5/6): document.description is JSON-encoded
// {"en": "...", "<language>": "..."} — server-side mirror is
// app/db.py's description_for(). Falls back to English, then "" (never
// null/undefined — every existing caller already treats "" as "nothing
// to show"). Handles a pre-2026-09-24 legacy plain-text row the same
// defensive way the backend does: not valid JSON -> the English text
// directly, not a crash.
export function descriptionFor(raw: string | null, language: string): string {
  if (!raw) return ''
  let byLanguage: Record<string, string>
  try {
    const parsed: unknown = JSON.parse(raw)
    byLanguage = parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : { en: raw }
  } catch {
    byLanguage = { en: raw }
  }
  return byLanguage[language] || byLanguage.en || ''
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
      {/* No clearLabel (2026-09-23, live regression report item 5): doc_type
         is always set by the pipeline before a human ever sees this field,
         and clearing it back to an empty string has no meaningful effect
         anywhere downstream (checked: derive_expectations.py's doc_type
         matching, the PATCH endpoint) — a vestigial "—" pill nobody needs. */}
      <PillPicker
        options={isLegacyValue ? [value, ...DOC_TYPES] : [...DOC_TYPES]}
        value={value}
        disabled={disabled}
        onChange={onChange}
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

/** Read-only "Only you" marker for a personal file (2026-09-24, round 13,
 * DECISIONS #85). Only the uploader is ever sent such a document, and the
 * uploader normally gets the lock TOGGLE (VisibilityToggle) instead; this is
 * the fallback for the rare caller who can see a personal file but may not
 * change it (a backend older than the toggle, or an uploader since demoted to
 * viewer). Same pill shape as StatusPill. */
export function PersonalFileBadge({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md bg-canvas px-2 py-0.5 text-[11px] font-mono uppercase tracking-wide text-ink ${className ?? ''}`}
    >
      <Lock size={11} aria-hidden="true" /> {t('ops.visibility.onlyYou')}
    </span>
  )
}
