import { Archive, Check, FileText, Loader2, Mic, MicOff, ShieldAlert, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { useSpeechCaption } from '../../hooks/useSpeechCaption'
import { ApiError } from '../../lib/apiClient'
import { normalizeImageForUpload } from '../../lib/imageNormalize'
import { roleAtLeast } from '../auth/authApi'
import { useAuth } from '../auth/AuthContext'
import { navigate } from '../../router/navigate'
import { routeHref } from '../../router/routes'
import {
  BUCKETS,
  DOC_TYPES,
  opsApi,
  type Bucket,
  type DocumentRow,
  type Expectation,
  type Obligation,
  type ReviewItem,
  type TraceReport,
  type UploadResult,
} from './opsApi'

// 2026-09-22 (DECISIONS #45): shared <datalist> id both DocumentCard's and
// ReviewQueueCard's vendor_name <input> point at via list=. One instance
// rendered once at the OpsConsole root (below) rather than duplicated per
// card - a <datalist> has no visual footprint, so it doesn't matter that
// it isn't physically next to the input using it.
const VENDOR_NAMES_DATALIST_ID = 'ops-vendor-names'

/** One field from a review_item.proposed_json blob — matches
 * app/models.py's Provenance[T], or a bare bool for injection_suspected. */
type ProposedField = { value: unknown; confidence: number } | boolean | null

function parseProposed(json: string): Record<string, ProposedField> {
  try {
    return JSON.parse(json) as Record<string, ProposedField>
  } catch {
    return {}
  }
}

function isProvenance(field: ProposedField | undefined): field is { value: unknown; confidence: number } {
  return typeof field === 'object' && field !== null && 'confidence' in field
}

/** "confidence: 30%", not "(0.30)" — a raw decimal next to a field reads
 * like a mysterious score; the labeled percentage reads as what it is
 * (2026-09-22). The one place this renders, so every field agrees. */
function formatConfidence(confidence: number): string {
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
function useDocumentBlobUrl(documentId: number, enabled = true): { blobUrl: string | null; failed: boolean } {
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

/** The source photo/PDF next to the fields a reviewer is confirming —
 * without it, confirming extracted fields isn't a safety check, it's a
 * rubber stamp (2026-09-22). A "reasonably-sized preview," not a document
 * viewer — the Documents tab's "View" action opens the full DocumentViewerModal instead. */
function DocumentPreview({
  documentId,
  mediaType,
  filename,
}: {
  documentId: number
  mediaType: string
  filename: string
}) {
  const { blobUrl, failed } = useDocumentBlobUrl(documentId)

  if (failed) return <p className="mt-3 text-[12px] text-muted">Couldn't load the source file.</p>
  if (!blobUrl) return <p className="mt-3 text-[12px] text-muted">Loading source…</p>

  if (mediaType === 'application/pdf') {
    return (
      <div className="mt-3">
        <embed src={blobUrl} type="application/pdf" className="h-64 w-full rounded-control border border-line" />
        <a href={blobUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] text-muted underline hover:text-ink">
          Open source PDF
        </a>
      </div>
    )
  }

  if (mediaType.startsWith('image/')) {
    return (
      <a href={blobUrl} target="_blank" rel="noreferrer" className="mt-3 block max-h-64 max-w-sm overflow-auto rounded-control border border-line">
        <img src={blobUrl} alt={`Source: ${filename}`} className="w-full object-contain" />
      </a>
    )
  }

  return null
}

/** Small preview next to each row in the Documents list (2026-09-22, doc
 * 2's preview UX pass) — a photo is often more recognizable at a glance
 * than its filename. Images fetch the real file (small, via the shared
 * blob-URL hook); PDFs get a generic icon rather than a rendered first
 * page, which is more machinery than this needs. */
function DocumentThumbnail({ documentId, mediaType }: { documentId: number; mediaType: string }) {
  const isImage = mediaType.startsWith('image/')
  const { blobUrl } = useDocumentBlobUrl(documentId, isImage)

  if (isImage) {
    return (
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-control border border-line bg-canvas">
        {blobUrl && <img src={blobUrl} alt="" className="h-full w-full object-cover" />}
      </div>
    )
  }

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control border border-line bg-canvas text-muted" aria-hidden="true">
      <FileText size={20} />
    </div>
  )
}

/** In-page replacement for the old "View" action's window.open() (2026-
 * 09-22, doc 2's preview UX pass): that landed on a bare blob: URL with
 * no chrome and no way back — a dead end, especially on mobile, confirmed
 * live. This renders the same source bytes inline instead: closable with
 * Escape, the X, or a click on the backdrop, never a new tab. */
function DocumentViewerModal({
  documentId,
  filename,
  mediaType,
  onClose,
}: {
  documentId: number
  filename: string
  mediaType: string
  onClose: () => void
}) {
  const { blobUrl, failed } = useDocumentBlobUrl(documentId)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${filename}`}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-card bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <p className="truncate text-sm font-medium text-ink">{filename}</p>
          <button
            onClick={onClose}
            className="shrink-0 rounded-control p-1 text-muted hover:bg-canvas hover:text-ink"
            aria-label="Close preview"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {failed && <p className="text-[13px] text-red-700">Couldn't load the source file.</p>}
          {!failed && !blobUrl && <p className="text-[13px] text-muted">Loading source…</p>}
          {blobUrl && mediaType === 'application/pdf' && (
            <embed src={blobUrl} type="application/pdf" className="h-[70vh] w-full rounded-control border border-line" />
          )}
          {blobUrl && mediaType.startsWith('image/') && (
            <img src={blobUrl} alt={`Source: ${filename}`} className="mx-auto max-h-[70vh] w-auto object-contain" />
          )}
        </div>
      </div>
    </div>
  )
}

const FIELD_CLASS =
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
function DocTypeField({
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
  if (lane === 'statutory') {
    return <input value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={className} />
  }
  const isLegacyValue = value !== '' && !(DOC_TYPES as readonly string[]).includes(value)
  return (
    <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">—</option>
      {isLegacyValue && <option value={value}>{value} (legacy)</option>}
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
function VoiceCaptionButton({ onCaption, disabled }: { onCaption: (text: string) => void; disabled: boolean }) {
  const { supported, listening, start, stop } = useSpeechCaption(onCaption)
  if (!supported) return null
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => (listening ? stop() : start())}
      aria-label={listening ? 'Stop recording caption' : 'Record a caption by voice'}
      title={listening ? 'Stop recording' : 'Record a caption by voice'}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-line disabled:text-muted disabled:opacity-60 ${listening ? 'border-red-300 bg-red-50 text-red-600' : 'text-muted hover:border-ink/40 hover:text-ink'}`}
    >
      {listening ? <MicOff size={14} /> : <Mic size={14} />}
    </button>
  )
}

/** "Is this a picture, not a document?" as an after-upload correction —
 * grouped with the other document-level metadata fields (2026-09-23),
 * not a separate special control, matching the upload-time toggle
 * (OpsConsole's upload section below) it mirrors. One-directional by
 * design (DocumentEditRequest's docstring, app/models.py): once `locked`
 * (the document's saved lane is already 'memory'), there's nothing left
 * to correct, so the checkbox is shown checked and disabled rather than
 * implying an un-correction this doesn't support. */
function PictureToggleField({
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
  return (
    <label className="flex flex-col gap-1 text-[12px] text-muted sm:col-span-3">
      <span className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled || locked}
          onChange={(e) => onChange(e.target.checked)}
        />
        This is a picture, not a document
        {locked && <span className="text-[11px] text-muted">(already marked)</span>}
      </span>
      {checked && !locked && (
        <span className="text-[11px] text-muted">Reduces the accuracy of data detected from this file.</span>
      )}
    </label>
  )
}

function ReviewQueueCard({
  item,
  canResolve,
  onResolved,
  onRejected,
  onPoll,
}: {
  item: ReviewItem
  canResolve: boolean
  onResolved: () => void
  // 2026-09-23 (DECISIONS #50): distinct from onResolved (which always
  // triggers a refresh() that removes this card from the list) — this
  // lets OpsConsole show a "rejected and archived, upload a replacement?"
  // prompt that survives the card itself unmounting.
  onRejected: (filename: string) => void
  // 2026-09-23 (DECISIONS #56): re-fetches review items from OpsConsole
  // (the same refresh() every other mutation here already uses) — called
  // on a short bounded timer while this card is a picture-lane document
  // still waiting on jaga-vision's background caption. Not a generic
  // "refresh me" the card invents on its own: one existing data path,
  // reused.
  onPoll: () => void
}) {
  const proposed = parseProposed(item.proposed_json)
  const fieldNames = Object.keys(proposed).filter((k) => k !== 'injection_suspected' && isProvenance(proposed[k]))
  // 2026-09-22 (DECISIONS #40): every document now needs review, even a
  // clean one, so the card must read differently for "routine confirm" vs
  // "actual flag" or every single upload looks like something went wrong.
  // Checked against `reason` (an internal category, never rendered) rather
  // than parsing `question` (the human-facing text) — keeps the two
  // concerns independent, so wording can change without touching this.
  const isRoutine = item.reason === 'clean extraction'

  const [edits, setEdits] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const name of fieldNames) {
      const field = proposed[name]
      initial[name] = isProvenance(field) && field.value !== null && field.value !== undefined ? String(field.value) : ''
    }
    return initial
  })
  // 2026-09-22: the LLM's suggested description/bucket/doc_type/vendor_name
  // (app/graph/classify.py), editable here at the same time as the
  // extracted fields — one Accept saves all of it, rather than a second
  // separate save step. bucket/doc_type/vendor_name replace the old tags
  // input (DECISIONS #42 — supersedes the tag table, not the "every
  // document needs review" rule above, which is unchanged).
  const [description, setDescription] = useState(item.document_description ?? '')
  const [bucket, setBucket] = useState(item.document_bucket ?? '')
  const [docType, setDocType] = useState(item.document_doc_type ?? '')
  const [vendorName, setVendorName] = useState(item.document_vendor_name ?? '')
  const [filename, setFilename] = useState(item.document_filename)
  // 2026-09-23 (DECISIONS #52): "picture, not a document" correction,
  // available after upload too, not just at the moment of it — grouped
  // with the fields above rather than a separate control. One-directional
  // (see DocumentEditRequest's docstring): once the saved lane is already
  // 'memory' there's nothing left to correct, so the checkbox locks in
  // that state rather than pretending an un-correction is supported.
  const [isPictureToggle, setIsPictureToggle] = useState(item.document_lane === 'memory')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const isPictureLane = item.document_lane === 'memory'
  // Distinguishes "no caption yet" (the is_picture upload path leaves
  // description NULL on purpose) from "someone deliberately cleared it" —
  // only meaningful while the field is still at its initial, unedited
  // value, same as any placeholder.
  const isPendingCaption = isPictureLane && item.document_description === null

  // 2026-09-23 (DECISIONS #56): a caption that lands via a poll tick (or
  // any other refresh) only reaches this card through the `item` prop —
  // local `description` state was set once at mount and never otherwise
  // re-synced from props, so without this the card would show "no
  // caption yet" forever despite the database already having a real one
  // (confirmed live: a genuine caption was generated and saved, but the
  // card never updated short of a full page reload). Guarded on the
  // functional updater's current value, not a dependency, so this can
  // never clobber a caption the person is already mid-typing/speaking —
  // it only ever fills the field from its untouched empty state.
  useEffect(() => {
    const fresh = item.document_description
    if (fresh === null) return
    setDescription((current) => (current === '' ? fresh : current))
  }, [item.document_description])

  // Polls only while genuinely needed — picture lane, no caption yet —
  // for a short bounded window comfortably past jaga-vision's measured
  // 6-20s captioning time (DECISIONS #55), then gives up silently. Not a
  // general-purpose real-time system: a plain interval, reusing
  // OpsConsole's existing refresh() (passed in as onPoll) rather than a
  // new fetch path. Stops itself the moment item.document_description
  // stops being null (the effect's own condition below then short-
  // circuits, and the cleanup from the previous run already cleared the
  // interval) — no separate "success" bookkeeping needed.
  useEffect(() => {
    if (!isPictureLane || item.document_description !== null) return
    const POLL_INTERVAL_MS = 3500
    const POLL_WINDOW_MS = 30000
    const deadline = Date.now() + POLL_WINDOW_MS
    const id = window.setInterval(() => {
      if (Date.now() >= deadline) {
        window.clearInterval(id)
        return
      }
      onPoll()
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [isPictureLane, item.document_description, onPoll])

  const originalValue = (name: string): string => {
    const field = proposed[name]
    return isProvenance(field) && field.value !== null && field.value !== undefined ? String(field.value) : ''
  }

  const resolve = async (action: 'confirm' | 'reject') => {
    setBusy(true)
    setError(null)
    try {
      const correctedFields: Record<string, unknown> = {}
      if (action === 'confirm') {
        for (const name of fieldNames) {
          if (edits[name] !== originalValue(name)) {
            const field = proposed[name]
            const isNumeric = isProvenance(field) && typeof field.value === 'number'
            correctedFields[name] = isNumeric ? Number(edits[name]) : edits[name]
          }
        }
        const documentEdits: {
          description?: string
          bucket?: Bucket
          doc_type?: string
          vendor_name?: string
          filename?: string
          is_picture?: boolean
        } = {}
        if (description !== (item.document_description ?? '')) documentEdits.description = description
        if (bucket && bucket !== (item.document_bucket ?? '')) documentEdits.bucket = bucket as Bucket
        if (docType !== (item.document_doc_type ?? '')) documentEdits.doc_type = docType
        if (vendorName !== (item.document_vendor_name ?? '')) documentEdits.vendor_name = vendorName
        if (filename !== item.document_filename) documentEdits.filename = filename
        if (isPictureToggle && !isPictureLane) documentEdits.is_picture = true
        if (Object.keys(documentEdits).length > 0) {
          await opsApi.editDocument(item.document_id, documentEdits)
        }
      }
      await opsApi.resolveReview(item.id, item.thread_id, { action, corrected_fields: correctedFields })
      if (action === 'reject') onRejected(item.document_filename)
      onResolved()
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) {
        // The in-memory LangGraph checkpoint is gone (server restart since
        // upload — docs/HANDOFF.md's known MemorySaver limitation). Accept
        // and Reject would both just fail again the same way. Archive is
        // the only way out now that it exists (2026-09-22, DECISIONS #37)
        // — the raw "backend restarted... checkpoint is gone" detail stays
        // in the network response for debugging, not shown to the user.
        setExpired(true)
        setBusy(false)
        return
      }
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const archiveExpired = async () => {
    setBusy(true)
    setError(null)
    try {
      await opsApi.archiveDocument(item.document_id)
      onResolved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Card className="p-5" interactive={false}>
      {/* 2026-09-23 (DECISIONS #52): supersedes DECISIONS #49's "filename
         as the card's editable title" — filename isn't shown prominently
         anywhere now (it moved into the Document fields group below,
         alongside description/bucket/doc_type/vendor_name). The reason
         this document needs review is the single most useful thing a
         reviewer can see first, so it's what leads the card now — no
         separate title competing with it, and nothing else worth
         duplicating from further down. */}
      <p className={`text-[13px] ${isRoutine ? 'text-muted' : 'text-amber-800'}`}>{item.question}</p>

      <DocumentPreview documentId={item.document_id} mediaType={item.document_media_type} filename={item.document_filename} />

      {/* Document-level metadata (organizational: what kind of thing this
         is, who it's from) vs. extracted line-item fields (what the model
         actually read off the page) are conceptually different — grouped
         and headed separately (2026-09-22, DECISIONS #49) rather than one
         undifferentiated stack of same-weight labels. */}
      {!expired && (
        <div className="mt-4">
          <h3 className="mb-2 text-[11px] font-mono uppercase tracking-wide text-muted">Document</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-[12px] text-muted sm:col-span-3">
              Filename
              <input
                value={filename}
                disabled={!canResolve}
                onChange={(e) => setFilename(e.target.value)}
                className="mt-1 block h-9 w-full rounded-control border border-line px-2.5 text-[13px] text-ink outline-none focus:border-ink disabled:bg-canvas disabled:text-muted"
              />
            </label>
            <label className="text-[12px] text-muted sm:col-span-3">
              Description
              <div className="mt-1 flex items-center gap-2">
                <input
                  value={description}
                  disabled={!canResolve}
                  placeholder={isPendingCaption ? 'No caption yet — tap the mic or type one' : undefined}
                  onChange={(e) => setDescription(e.target.value)}
                  className="block h-9 w-full flex-1 rounded-control border border-line px-2.5 text-[13px] text-ink outline-none focus:border-ink disabled:bg-canvas disabled:text-muted"
                />
                {/* Voice caption (2026-09-23): only for picture-lane
                   documents — a real document's description reads off
                   printed text a person can just type; a photo has no
                   text to read, so speaking a caption is the faster path.
                   Renders nothing when the browser has no Web Speech API
                   (e.g. Firefox) — this plain text input is already the
                   fallback, no separate code path needed. */}
                {isPictureLane && (
                  <VoiceCaptionButton onCaption={setDescription} disabled={!canResolve} />
                )}
              </div>
            </label>
            <label className="text-[12px] text-muted">
              Bucket
              <select
                value={bucket}
                disabled={!canResolve}
                onChange={(e) => setBucket(e.target.value)}
                className="mt-1 block h-9 w-full rounded-control border border-line bg-white px-2.5 text-[13px] text-ink outline-none focus:border-ink disabled:bg-canvas disabled:text-muted"
              >
                <option value="">—</option>
                {BUCKETS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </label>
            <label className="text-[12px] text-muted">
              Doc type
              <DocTypeField
                lane={item.document_lane}
                value={docType}
                disabled={!canResolve}
                onChange={setDocType}
                className={`mt-1 ${FIELD_CLASS}`}
              />
            </label>
            <label className="text-[12px] text-muted">
              Vendor name
              <input
                value={vendorName}
                disabled={!canResolve}
                placeholder="—"
                list={VENDOR_NAMES_DATALIST_ID}
                onChange={(e) => setVendorName(e.target.value)}
                className="mt-1 block h-9 w-full rounded-control border border-line px-2.5 text-[13px] text-ink outline-none focus:border-ink disabled:bg-canvas disabled:text-muted"
              />
            </label>
            <PictureToggleField
              checked={isPictureToggle}
              locked={isPictureLane}
              disabled={!canResolve}
              onChange={setIsPictureToggle}
            />
          </div>
        </div>
      )}

      {!expired && fieldNames.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="mb-2 text-[11px] font-mono uppercase tracking-wide text-muted">Extracted fields</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {fieldNames.map((name) => {
              const field = proposed[name]
              const confidence = isProvenance(field) ? field.confidence : null
              return (
                <label key={name} className="text-[12px] text-muted">
                  {name}
                  {confidence !== null && (
                    <span className={confidence < 0.6 ? 'ml-1 text-red-600' : 'ml-1 text-muted'}>
                      ({formatConfidence(confidence)})
                    </span>
                  )}
                  <input
                    value={edits[name]}
                    disabled={!canResolve}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [name]: e.target.value }))}
                    className="mt-1 block h-9 w-full rounded-control border border-line px-2.5 text-[13px] text-ink outline-none focus:border-ink disabled:bg-canvas disabled:text-muted"
                  />
                </label>
              )
            })}
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-[13px] text-red-700">{error}</p>}

      {expired ? (
        <div className="mt-4">
          <p className="text-[13px] text-red-700">This document can no longer be reviewed automatically.</p>
          {canResolve ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => void archiveExpired()} disabled={busy} icon={<Archive size={14} />}>
                Archive
              </Button>
              {busy && <Loader2 size={16} className="animate-spin self-center text-muted" />}
              <span className="text-[12px] text-muted">or re-upload the document to try reviewing it again.</span>
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-muted">Only an admin or owner can archive this — or re-upload the document to try reviewing it again.</p>
          )}
        </div>
      ) : canResolve ? (
        <div className="mt-4">
          {/* Repeats the same flagged reason shown at the top of the card
             (2026-09-23) — on a long card (preview image + Document +
             Extracted fields), a reviewer scrolling to these buttons can
             lose sight of why this document needs scrutiny before
             clicking. Routine "no issues found" confirms have nothing to
             repeat, so this stays gated on !isRoutine like the top copy. */}
          {!isRoutine && <p className="mb-2 text-[13px] text-amber-800">{item.question}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void resolve('confirm')} disabled={busy} icon={<Check size={14} />}>
              Accept{Object.keys(edits).some((n) => edits[n] !== originalValue(n)) ? ' with corrections' : ' as-is'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void resolve('reject')} disabled={busy} icon={<X size={14} />}>
              Reject
            </Button>
            {busy && <Loader2 size={16} className="animate-spin self-center text-muted" />}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[12px] text-muted">Only an admin or owner can resolve this.</p>
      )}
    </Card>
  )
}

/** One row in the Documents tab (2026-09-22: cards, not a table — see
 * DECISIONS #38). Owns its own edit-mode state, matching ReviewQueueCard's
 * fields (description/bucket/doc_type/vendor_name/filename — DECISIONS
 * #42 superseded the old tags input) and the same disabled-vs-editing
 * pattern. */
function DocumentCard({
  doc,
  canEdit,
  canArchive,
  onView,
  onTrace,
  onArchive,
  onSaved,
}: {
  doc: DocumentRow
  canEdit: boolean
  canArchive: boolean
  onView: () => void
  onTrace: () => void
  onArchive: () => void
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [description, setDescription] = useState(doc.description ?? '')
  const [bucket, setBucket] = useState(doc.bucket ?? '')
  const [docType, setDocType] = useState(doc.doc_type ?? '')
  const [vendorName, setVendorName] = useState(doc.vendor_name ?? '')
  const [filename, setFilename] = useState(doc.filename)
  // 2026-09-23 (DECISIONS #52): see PictureToggleField's docstring —
  // same one-directional "correct into memory lane" control as the
  // review card, grouped with the other editable fields here too.
  const [isPictureToggle, setIsPictureToggle] = useState(doc.lane === 'memory')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isPictureLane = doc.lane === 'memory'
  const isPendingCaption = isPictureLane && doc.description === null

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await opsApi.editDocument(doc.id, {
        description,
        bucket: (bucket || undefined) as Bucket | undefined,
        doc_type: docType,
        vendor_name: vendorName,
        filename,
        ...(isPictureToggle && !isPictureLane ? { is_picture: true } : {}),
      })
      setEditing(false)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4" interactive={false}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 gap-3">
          <DocumentThumbnail documentId={doc.id} mediaType={doc.media_type} />
          <div className="min-w-0 flex-1">
            {/* 2026-09-23 (DECISIONS #52): supersedes DECISIONS #49's
               "filename as this card's title" — filename isn't shown
               prominently anywhere now (it's a plain field inside the
               edit form below, alongside description/bucket/doc_type/
               vendor_name). Description is the one-sentence, human-
               written-to-be-recognizable summary this app already
               generates for every document — a better at-a-glance label
               than a raw filename, and this is its only appearance on
               the card, not a second copy alongside a filename-based one. */}
            <p className="break-words text-sm font-medium text-ink">
              {doc.description ? (
                doc.description
              ) : isPendingCaption ? (
                <span className="italic text-muted">No caption yet</span>
              ) : (
                <span className="text-muted">{doc.lane ?? '—'} / {doc.doc_type ?? '—'}</span>
              )}
            </p>
            {doc.description && (
              <p className="mt-0.5 break-words text-[12px] text-muted">{doc.lane ?? '—'} / {doc.doc_type ?? '—'}</p>
            )}
            {doc.vendor_name && <p className="mt-0.5 break-words text-[12px] text-muted">{doc.vendor_name}</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusPill status={doc.status} />
          {doc.bucket && <Badge tone="neutral">{doc.bucket}</Badge>}
        </div>
      </div>

      {editing && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder="Filename"
            className="block h-9 w-full rounded-control border border-line px-2.5 text-[13px] text-ink outline-none focus:border-ink sm:col-span-3"
          />
          <div className="flex items-center gap-2 sm:col-span-3">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={isPendingCaption ? 'No caption yet — tap the mic or type one' : 'Description'}
              className="block h-9 w-full flex-1 rounded-control border border-line px-2.5 text-[13px] text-ink outline-none focus:border-ink"
            />
            {isPictureLane && <VoiceCaptionButton onCaption={setDescription} disabled={false} />}
          </div>
          <select
            value={bucket}
            onChange={(e) => setBucket(e.target.value)}
            className="block h-9 w-full rounded-control border border-line bg-white px-2.5 text-[13px] text-ink outline-none focus:border-ink"
          >
            <option value="">No bucket</option>
            {BUCKETS.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <DocTypeField lane={doc.lane} value={docType} disabled={false} onChange={setDocType} className={FIELD_CLASS} />
          <input
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            placeholder="Vendor name"
            list={VENDOR_NAMES_DATALIST_ID}
            className="block h-9 w-full rounded-control border border-line px-2.5 text-[13px] text-ink outline-none focus:border-ink"
          />
          <PictureToggleField
            checked={isPictureToggle}
            locked={isPictureLane}
            disabled={false}
            onChange={setIsPictureToggle}
          />
          {error && <p className="text-[12px] text-red-700 sm:col-span-3">{error}</p>}
          <div className="flex gap-2 sm:col-span-3">
            <Button size="sm" onClick={() => void save()} disabled={busy}>Save</Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <button onClick={onView} className="text-[12px] font-mono uppercase tracking-wide text-muted hover:text-ink">
          View
        </button>
        <button onClick={onTrace} className="text-[12px] font-mono uppercase tracking-wide text-muted hover:text-ink">
          Trace
        </button>
        {canEdit && !editing && (
          <button onClick={() => setEditing(true)} className="text-[12px] font-mono uppercase tracking-wide text-muted hover:text-ink">
            Edit
          </button>
        )}
        {/* No doc.status !== 'archived' guard needed (2026-09-23, DECISIONS
           #53) — the server never sends an archived document to this list
           at all anymore, so every doc rendered here is guaranteed live. */}
        {canArchive && (
          <button onClick={onArchive} className="text-[12px] font-mono uppercase tracking-wide text-muted hover:text-red-700">
            Archive
          </button>
        )}
      </div>
    </Card>
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

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-mono uppercase tracking-wide ${STATUS_TONE[status] ?? 'bg-canvas text-muted'}`}>
      {status}
    </span>
  )
}

type DateBasis = 'upload' | 'document'

// Amendment 2 (2026-09-22, DECISIONS #43): these exact two labels, not
// "Received"/"Occurred" or any other wording — the toggle control itself
// (tabs here) was left "your call".
const DATE_BASIS_OPTIONS: { id: DateBasis; label: string }[] = [
  { id: 'upload', label: 'Upload date' },
  { id: 'document', label: 'Document date' },
]

function DateGroupRow({ doc }: { doc: DocumentRow }) {
  return (
    <div className="flex items-center gap-2 rounded-control border border-line bg-white px-3 py-2 text-[13px]">
      <span className="min-w-0 flex-1 truncate text-ink">{doc.filename}</span>
      {doc.bucket && <Badge tone="neutral">{doc.bucket}</Badge>}
      <StatusPill status={doc.status} />
    </div>
  )
}

/** Groups documents by date (2026-09-22, doc 3's calendar wiring). Not
 * the logged-out marketing preview's CalendarPreview/WeekGrid at
 * /calendar — that models generic meetings with mock data and no
 * session; this is inside /ops, over real session-scoped documents, and
 * reuses whatever list it's handed rather than a new endpoint. Two date
 * bases: received_at (upload timestamp, always set) and occurred_on (the
 * document's own date — invoice/statutory issued_on, or EXIF for photos;
 * not every document has one — Amendment 2 requires saying so plainly
 * rather than silently dropping those documents from the view). A flat
 * grouped/sorted list, deliberately no week/day grid or drag-and-drop —
 * "your call" on how minimal to keep this, and this is all it needs. */
function DatesView({ documents }: { documents: DocumentRow[] }) {
  const [basis, setBasis] = useState<DateBasis>('upload')

  const { sortedDays, noDate } = useMemo(() => {
    const byDay = new Map<string, DocumentRow[]>()
    const withoutDate: DocumentRow[] = []
    for (const doc of documents) {
      const raw = basis === 'upload' ? doc.received_at : doc.occurred_on
      if (!raw) {
        withoutDate.push(doc)
        continue
      }
      const day = raw.slice(0, 10) // "YYYY-MM-DD..." -> "YYYY-MM-DD", both sources agree on this prefix
      const existing = byDay.get(day)
      if (existing) existing.push(doc)
      else byDay.set(day, [doc])
    }
    return {
      sortedDays: [...byDay.entries()].sort(([a], [b]) => (a < b ? 1 : -1)),
      noDate: withoutDate,
    }
  }, [documents, basis])

  return (
    <div>
      <div className="mb-4 flex w-fit gap-0.5 rounded-control border border-line p-0.5">
        {DATE_BASIS_OPTIONS.map((opt) => {
          const active = basis === opt.id
          return (
            <button
              key={opt.id}
              onClick={() => setBasis(opt.id)}
              className={`rounded-md px-3 py-1.5 text-[13px] transition-colors ${active ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      {documents.length === 0 ? (
        <p className="rounded-card border border-line bg-white p-6 text-sm text-muted">No documents uploaded yet.</p>
      ) : (
        <div className="space-y-6">
          {sortedDays.map(([day, docs]) => (
            <section key={day}>
              <h3 className="mb-2 text-[11px] font-mono uppercase tracking-wide text-muted">{day} ({docs.length})</h3>
              <div className="space-y-1">
                {docs.map((doc) => <DateGroupRow key={doc.id} doc={doc} />)}
              </div>
            </section>
          ))}

          {basis === 'document' && noDate.length > 0 && (
            <section>
              <h3 className="mb-2 text-[11px] font-mono uppercase tracking-wide text-muted">
                No document date ({noDate.length})
              </h3>
              <div className="space-y-1">
                {noDate.map((doc) => <DateGroupRow key={doc.id} doc={doc} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}

/** Was five stacked <section>s on one long scroll — no navigation between
 * them (2026-09-22 user feedback). Real conditional rendering per tab, not
 * CSS-hidden panels: an inactive tab's rows cost nothing while inactive. */
type OpsTab = 'review' | 'documents' | 'dates' | 'gaps' | 'obligations'

const OPS_TABS: { id: OpsTab; label: string }[] = [
  { id: 'review', label: 'Upload & Review' },
  { id: 'documents', label: 'Documents' },
  { id: 'dates', label: 'Dates' },
  { id: 'gaps', label: 'Gap Analysis' },
  { id: 'obligations', label: 'Obligations' },
]

/** The logged-in app: add a document, watch the agent process it, confirm
 * anything flagged, see the gap analysis and obligations it produces.
 * Session-scoped (features/auth) — company_id is never passed by hand,
 * the backend derives it from the bearer token. What renders (the upload
 * box, the Accept/Reject buttons) depends on role, not on hiding data —
 * the backend rejects the write either way (app/auth.py's require_role);
 * this only avoids offering a control that would 403. */
export function OpsConsole() {
  const { status, user, company, role } = useAuth()
  const [apiUp, setApiUp] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [expectations, setExpectations] = useState<Expectation[]>([])
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [lastUpload, setLastUpload] = useState<UploadResult | null>(null)
  const [trace, setTrace] = useState<{ documentId: number; report: TraceReport } | null>(null)
  const [activeTab, setActiveTab] = useState<OpsTab>('review')
  // Real search (2026-09-22) — searchResults===null means "not searching,
  // show the normal list"; an array (even empty) means "showing search
  // results instead". Kept separate from `documents` rather than
  // replacing it, so clearing the search just restores the full list
  // with no refetch.
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<DocumentRow[] | null>(null)
  // 2026-09-22 (DECISIONS #42): fixed bucket taxonomy replaces the old
  // tag-chip filter (activeTagFilter) — same "narrow the current view"
  // role, now over a closed 6-value set instead of a fetched tag list.
  const [activeBucketFilter, setActiveBucketFilter] = useState<Bucket | null>(null)
  // In-page preview (2026-09-22, doc 2's preview UX pass) — replaces
  // openDocumentSource's window.open() new tab. null means no modal open.
  const [viewingDocument, setViewingDocument] = useState<DocumentRow | null>(null)
  // 2026-09-23 (DECISIONS #50): filename of the document just rejected, or
  // null — drives the "rejected and archived, upload a replacement?"
  // prompt. Lives here rather than inside ReviewQueueCard since that card
  // unmounts the moment onResolved()'s refresh() removes the now-resolved
  // item from reviewItems.
  const [justRejectedFilename, setJustRejectedFilename] = useState<string | null>(null)
  // Lets "Upload a replacement" open the native file picker directly —
  // .click() on a hidden file input works when it's the synchronous result
  // of a real click, same category as the window.open() popup workaround
  // elsewhere in this file (an async gap in between is what gets blocked,
  // not the technique itself).
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 2026-09-23 (DECISIONS #52): the upload-time "is this a picture, not a
  // document?" toggle — defaults to No (the common case is still a real
  // document); reset after every upload in onUpload below.
  const [isPictureUpload, setIsPictureUpload] = useState(false)

  useEffect(() => {
    opsApi
      .health()
      .then(() => setApiUp(true))
      .catch(() => setApiUp(false))
  }, [])

  useEffect(() => {
    if (status === 'signed-out') navigate(routeHref('login'))
  }, [status])

  const refresh = useCallback(async () => {
    const [docs, exps, obls, reviews] = await Promise.all([
      opsApi.listDocuments(),
      opsApi.listExpectations(),
      opsApi.listObligations(),
      opsApi.listReviewItems(),
    ])
    setDocuments(docs)
    setExpectations(exps)
    setObligations(obls)
    setReviewItems(reviews)
  }, [])

  useEffect(() => {
    if (status !== 'signed-in') return
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [status, refresh])

  const onUpload = async (file: File) => {
    setBusy(true)
    setError(null)
    setJustRejectedFilename(null)
    try {
      const normalized = await normalizeImageForUpload(file)
      const result = await opsApi.uploadDocument(normalized, isPictureUpload)
      setLastUpload(result)
      // 2026-09-23: back to the default (No) after every upload — the
      // common case is still a real document, and leaving Yes stuck on
      // would silently mis-tag the next, unrelated file.
      setIsPictureUpload(false)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const viewTrace = async (documentId: number) => {
    const report = await opsApi.getTrace(documentId)
    setTrace({ documentId, report })
  }

  const archiveDocument = async (documentId: number) => {
    try {
      await opsApi.archiveDocument(documentId)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const runSearch = async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setSearchResults(null)
      return
    }
    try {
      setSearchResults(await opsApi.search(trimmed))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted">
        <Loader2 size={16} className="animate-spin" /> Checking your session…
      </div>
    )
  }

  if (status === 'signed-out') {
    // useEffect above is already redirecting to /login; this is what
    // renders for the one tick before that navigation completes.
    return <p className="py-16 text-sm text-muted">Redirecting to log in…</p>
  }

  const canUpload = role !== null && roleAtLeast(role, 'user')
  const canResolve = role !== null && roleAtLeast(role, 'admin')
  // 2026-09-22 (DECISIONS #47): same routine-vs-flagged distinction
  // ReviewQueueCard already makes (isRoutine, DECISIONS #40) — a clean
  // upload's badge shouldn't read as "something's wrong" here either.
  const isRoutineUpload = lastUpload?.status === 'needs_review' && lastUpload.review?.reason === 'clean extraction'
  // Bucket filter applies on top of whichever base list is active. No
  // archived-status filtering here anymore (2026-09-23, DECISIONS #53) —
  // the server never sends an archived document to any role in the first
  // place (GET /api/documents, GET /api/search both exclude it
  // unconditionally), so there's nothing left for the client to hide.
  const baseDocuments = searchResults ?? documents
  const bucketCounts = Object.fromEntries(
    BUCKETS.map((b) => [b, baseDocuments.filter((d) => d.bucket === b).length]),
  ) as Record<Bucket, number>
  const visibleDocuments = activeBucketFilter
    ? baseDocuments.filter((d) => d.bucket === activeBucketFilter)
    : baseDocuments
  // 2026-09-22 (DECISIONS #45): vendor_name autocomplete source — distinct
  // values already on this company's documents, no new endpoint. Sourced
  // from the full `documents` list (not search/bucket-filtered) so the
  // suggestions don't shrink just because the Documents tab has a filter
  // active.
  const vendorNames = [...new Set(documents.map((d) => d.vendor_name).filter((v): v is string => Boolean(v)))].sort()

  return (
    <div className="space-y-6">
      <datalist id={VENDOR_NAMES_DATALIST_ID}>
        {vendorNames.map((v) => <option key={v} value={v} />)}
      </datalist>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
        <span className="inline-flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${apiUp ? 'bg-sage' : 'bg-red-500'}`} aria-hidden="true" />
          {apiUp === null && 'Checking backend…'}
          {apiUp === true && 'Backend reachable'}
          {apiUp === false && 'Backend unreachable — start it with `uvicorn app.main:app --reload` in app/'}
        </span>
        {company && user && (
          <span>
            {company.name} · {user.email} · <Badge mono>{role}</Badge>
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      <div role="tablist" aria-label="Ops sections" className="flex flex-wrap gap-0.5 border-b border-line">
        {OPS_TABS.map((tab) => {
          const active = activeTab === tab.id
          const badge = tab.id === 'review' && reviewItems.length > 0 ? ` (${reviewItems.length})` : ''
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={active}
              id={`ops-tab-${tab.id}`}
              aria-controls={`ops-panel-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              // Same weight in both states on purpose (DECISIONS #27 — a
              // bolder active tab elsewhere in this app widened it and
              // nudged its neighbour; only background/color changes here).
              className={`rounded-md px-3 py-2 text-sm transition-colors ${active ? 'bg-canvas text-ink' : 'text-muted hover:text-ink'}`}
            >
              {tab.label}
              {badge}
            </button>
          )
        })}
      </div>

      {activeTab === 'review' && (
        <div role="tabpanel" id="ops-panel-review" aria-labelledby="ops-tab-review" className="space-y-8">
          <Card className="p-6" interactive={false}>
            {canUpload && (
              <div className="mb-4">
                {/* 2026-09-23 (DECISIONS #52): the primary human-facing
                   control for the memory/picture case — automatic
                   classification among the other three lanes (statutory/
                   invoice/important) is untouched; this only ever decides
                   "picture, yes or no." Same pill-toggle pattern as the
                   Dates tab's Upload date/Document date switch, for a
                   consistent look at a control this prominent. Default No
                   — the common case is still a real document. */}
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[13px] text-ink">Is this a picture, not a document?</span>
                  <div className="flex gap-0.5 rounded-control border border-line p-0.5">
                    {([false, true] as const).map((val) => {
                      const active = isPictureUpload === val
                      return (
                        <button
                          key={String(val)}
                          type="button"
                          onClick={() => setIsPictureUpload(val)}
                          className={`rounded-md px-3 py-1 text-[13px] transition-colors ${active ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
                        >
                          {val ? 'Yes' : 'No'}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {isPictureUpload && (
                  <p className="mt-1.5 text-[12px] text-muted">
                    Choosing yes reduces the accuracy of data detected from this file — select no for invoices, forms, and other documents.
                  </p>
                )}
              </div>
            )}

            {canUpload ? (
              <label className="flex h-24 cursor-pointer items-center justify-center gap-2 rounded-card border border-dashed border-line text-sm text-muted hover:border-ink/40">
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {busy ? 'Uploading…' : 'Click to upload a PDF or image'}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void onUpload(file)
                    e.target.value = ''
                  }}
                />
              </label>
            ) : (
              <p className="flex h-24 items-center justify-center rounded-card border border-dashed border-line text-sm text-muted">
                Viewers can't upload documents — ask an admin or owner.
              </p>
            )}

            {/* 2026-09-23 (DECISIONS #50): closes the loop after a reject
               — it used to just disappear from the queue with no
               indication of where it went or what to do next. Simple
               inline prompt, not a modal — "Upload a replacement" opens
               the file picker directly rather than just scrolling to it. */}
            {justRejectedFilename && canUpload && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-canvas p-4 text-[13px]">
                <p className="text-ink">
                  <span className="font-medium">{justRejectedFilename}</span> rejected and archived. Upload a replacement?
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setJustRejectedFilename(null)
                    fileInputRef.current?.click()
                  }}
                >
                  Upload a replacement
                </Button>
              </div>
            )}

            {lastUpload && (
              <div className="mt-4 rounded-card border border-line bg-canvas p-4 text-[13px]">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">Last upload result:</span>
                  {!isRoutineUpload && <StatusPill status={lastUpload.status} />}
                </div>
                {lastUpload.classify && (
                  <p className="mt-1 text-muted">
                    {/* This is classification confidence ("this looks like an
                       invoice"), not extraction accuracy — scoping the label
                       to document-type detection so it doesn't read as a
                       blanket trust score on the extracted fields (2026-09-22). */}
                    classified as {lastUpload.classify.lane} / {lastUpload.classify.doc_type} ({(lastUpload.classify.confidence * 100).toFixed(0)}% confident)
                    {lastUpload.classify.injection_suspected && (
                      <span className="ml-2 inline-flex items-center gap-1 text-red-700">
                        <ShieldAlert size={12} /> injection suspected
                      </span>
                    )}
                  </p>
                )}
                {lastUpload.status === 'needs_review' && lastUpload.review?.question && (
                  <p className="mt-1 text-amber-800">Review: {lastUpload.review.question}</p>
                )}
                {lastUpload.status === 'quarantined' && (
                  <p className="mt-1 text-red-700">Quarantined by the injection guardrail — obligation table untouched.</p>
                )}
              </div>
            )}
          </Card>

          {reviewItems.length > 0 && (
            <section>
              <h2 className="mb-3 text-[11px] font-mono uppercase tracking-wide text-amber-800">
                Needs review ({reviewItems.length})
              </h2>
              <div className="space-y-3">
                {reviewItems.map((item) => (
                  <ReviewQueueCard
                    key={item.id}
                    item={item}
                    canResolve={canResolve}
                    onResolved={() => void refresh()}
                    onRejected={setJustRejectedFilename}
                    onPoll={() => void refresh()}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <div role="tabpanel" id="ops-panel-documents" aria-labelledby="ops-tab-documents" className="space-y-8">
          <section>
            {/* Cards, not a table (2026-09-22, DECISIONS #37): a 4-column
               table has no room on a ~375px phone regardless of text
               wrapping — confirmed live, filename/doc_type were cut off
               with no way to see the rest. Cards match ReviewQueueCard's
               existing pattern in this file: filename/doc_type wrap
               naturally (min-w-0 + break-words), no responsive breakpoint
               logic needed. */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[11px] font-mono uppercase tracking-wide text-muted">
                Documents ({visibleDocuments.length})
              </h2>
            </div>

            {/* Real search (2026-09-22, DECISIONS #40) — tenant-scoped
               GET /api/search over filename/doc_type/description/
               extracted_text/bucket/vendor_name. Not the same thing as
               features/search/'s mock preview on the logged-out landing
               page (no session there to call this with); this is the
               separate, authenticated search over real documents. */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void runSearch(searchQuery)
              }}
              className="mb-2 flex gap-2"
            >
              <input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  if (!e.target.value.trim()) setSearchResults(null)
                }}
                placeholder="Search documents…"
                className="h-9 flex-1 rounded-control border border-line px-2.5 text-[13px] text-ink outline-none focus:border-ink"
              />
              {searchResults !== null && (
                <Button
                  size="sm"
                  variant="secondary"
                  type="button"
                  onClick={() => {
                    setSearchQuery('')
                    setSearchResults(null)
                  }}
                >
                  Clear
                </Button>
              )}
            </form>

            {/* Fixed 6-bucket taxonomy (2026-09-22, DECISIONS #42) replaces
               the old fetched tag-chip row — not user-typed, so this is
               just BUCKETS, no API call. Counts reflect the currently
               active search + archived state, so they match what clicking
               a chip will actually show. */}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {BUCKETS.map((b) => {
                const active = activeBucketFilter === b
                return (
                  <button
                    key={b}
                    onClick={() => setActiveBucketFilter(active ? null : b)}
                    className={`rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors ${active ? 'bg-ink text-white' : 'bg-canvas text-muted hover:text-ink'}`}
                  >
                    {b} ({bucketCounts[b]})
                  </button>
                )
              })}
            </div>

            {visibleDocuments.length === 0 ? (
              <p className="rounded-card border border-line bg-white p-6 text-sm text-muted">
                {searchResults !== null ? 'No documents match that search.' : 'No documents uploaded yet.'}
              </p>
            ) : (
              <div className="space-y-2">
                {visibleDocuments.map((doc) => (
                  <DocumentCard
                    key={doc.id}
                    doc={doc}
                    canEdit={canUpload}
                    canArchive={canResolve}
                    onView={() => setViewingDocument(doc)}
                    onTrace={() => void viewTrace(doc.id)}
                    onArchive={() => void archiveDocument(doc.id)}
                    onSaved={() => void refresh()}
                  />
                ))}
              </div>
            )}
          </section>

          {trace && (
            <section>
              <h2 className="mb-3 text-[11px] font-mono uppercase tracking-wide text-muted">
                Trace — document #{trace.documentId} · total ${trace.report.total_cost_usd.toFixed(4)}
              </h2>
              <Card className="overflow-hidden p-0" interactive={false}>
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-canvas text-muted">
                    <tr>
                      <th className="px-4 py-2 font-normal">Node</th>
                      <th className="px-4 py-2 font-normal">Model</th>
                      <th className="px-4 py-2 font-normal">Tokens in/out</th>
                      <th className="px-4 py-2 font-normal">Cost</th>
                      <th className="px-4 py-2 font-normal">Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.report.nodes.map((node, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="px-4 py-2 text-ink">{node.node}</td>
                        <td className="px-4 py-2 text-muted">{node.model ?? '—'}</td>
                        <td className="px-4 py-2 text-muted">
                          {node.input_tokens ?? '—'} / {node.output_tokens ?? '—'}
                        </td>
                        <td className="px-4 py-2 text-muted">{node.cost_usd ? `$${node.cost_usd.toFixed(5)}` : '—'}</td>
                        <td className="px-4 py-2 text-muted">{node.decision ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </section>
          )}
        </div>
      )}

      {activeTab === 'dates' && (
        <div role="tabpanel" id="ops-panel-dates" aria-labelledby="ops-tab-dates">
          {/* No archived-status filter needed (2026-09-23, DECISIONS #53)
             — `documents` (GET /api/documents) never contains one. */}
          <DatesView documents={documents} />
        </div>
      )}

      {activeTab === 'gaps' && (
        <div role="tabpanel" id="ops-panel-gaps" aria-labelledby="ops-tab-gaps">
          <section>
            <h2 className="mb-3 text-[11px] font-mono uppercase tracking-wide text-muted">
              Gap analysis — {expectations.filter((e) => e.status === 'satisfied').length} of {expectations.length} held
            </h2>
            <Card className="overflow-hidden p-0" interactive={false}>
              {expectations.length === 0 ? (
                <p className="p-6 text-sm text-muted">No expectations yet — upload a statutory document that reads as a company event (incorporation, corp sec change).</p>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <tbody>
                    {expectations.map((exp) => (
                      <tr key={exp.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5 text-ink">{exp.label}</td>
                        <td className="px-4 py-2.5"><StatusPill status={exp.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </section>
        </div>
      )}

      {activeTab === 'obligations' && (
        <div role="tabpanel" id="ops-panel-obligations" aria-labelledby="ops-tab-obligations">
          <section>
            <h2 className="mb-3 text-[11px] font-mono uppercase tracking-wide text-muted">
              Obligations ({obligations.length})
            </h2>
            <Card className="overflow-hidden p-0" interactive={false}>
              {obligations.length === 0 ? (
                <p className="p-6 text-sm text-muted">No obligations derived yet.</p>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <tbody>
                    {obligations.map((ob) => (
                      <tr key={ob.id} className="border-b border-line last:border-0 align-top">
                        <td className="px-4 py-2.5 text-ink">
                          {ob.label}
                          <Badge tone="neutral" className="ml-2">{ob.risk}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-muted">{ob.due_on}</td>
                        <td className="px-4 py-2.5"><StatusPill status={ob.status} /></td>
                        <td className="max-w-xs px-4 py-2.5 text-[12px] text-muted">{ob.citation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </section>
        </div>
      )}

      {viewingDocument && (
        <DocumentViewerModal
          documentId={viewingDocument.id}
          filename={viewingDocument.filename}
          mediaType={viewingDocument.media_type}
          onClose={() => setViewingDocument(null)}
        />
      )}
    </div>
  )
}
