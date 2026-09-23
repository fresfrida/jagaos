/** One review-item card in the Upload & Review page's queue. Moved out of
 * OpsConsole.tsx verbatim (2026-09-23, header/nav restructure) — content
 * and behavior unchanged, only the file it lives in and where its shared
 * pieces (DocTypeField, VoiceCaptionButton, etc.) now come from. */

import { Archive, Check, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ApiError } from '../../lib/apiClient'
import {
  FIELD_CLASS,
  PictureToggleField,
  VENDOR_NAMES_DATALIST_ID,
  VoiceCaptionButton,
  DocTypeField,
  formatConfidence,
  useDocumentBlobUrl,
} from './opsShared'
import { BUCKETS, opsApi, type Bucket, type ReviewItem } from './opsApi'

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

/** The source photo/PDF next to the fields a reviewer is confirming —
 * without it, confirming extracted fields isn't a safety check, it's a
 * rubber stamp (2026-09-22). A "reasonably-sized preview," not a document
 * viewer — the Company Files page's "View" action opens the full
 * DocumentViewerModal instead. */
function DocumentPreview({
  documentId,
  mediaType,
  filename,
}: {
  documentId: number
  mediaType: string
  filename: string
}) {
  const { t } = useTranslation()
  const { blobUrl, failed } = useDocumentBlobUrl(documentId)

  if (failed) return <p className="mt-3 text-[12px] text-muted">{t('ops.documentPreview.loadFailed')}</p>
  if (!blobUrl) return <p className="mt-3 text-[12px] text-muted">{t('ops.documentPreview.loading')}</p>

  if (mediaType === 'application/pdf') {
    return (
      <div className="mt-3">
        <embed src={blobUrl} type="application/pdf" className="h-64 w-full rounded-control border border-line" />
        <a href={blobUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] text-muted underline hover:text-ink">
          {t('ops.documentPreview.openSourcePdf')}
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

export function ReviewQueueCard({
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
  // lets the Upload & Review page show a "rejected and archived, upload a
  // replacement?" prompt that survives the card itself unmounting.
  onRejected: (filename: string) => void
  // 2026-09-23 (DECISIONS #56): re-fetches review items from the page's
  // shared refresh() — called on a short bounded timer while this card is
  // a picture-lane document still waiting on jaga-vision's background
  // caption. Not a generic "refresh me" the card invents on its own: one
  // existing data path, reused.
  onPoll: () => void
}) {
  const { t } = useTranslation()
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
  // general-purpose real-time system: a plain interval, reusing the
  // page's existing refresh() (passed in as onPoll) rather than a new
  // fetch path. Stops itself the moment item.document_description stops
  // being null (the effect's own condition below then short-circuits, and
  // the cleanup from the previous run already cleared the interval) — no
  // separate "success" bookkeeping needed.
  //
  // 2026-09-23 (DECISIONS #58): also tracks whether the poll window is
  // currently active, separately from isPendingCaption (which stays true
  // forever if the window expires with no caption) — this is what drives
  // the "generating caption…" indicator below. Even with the model now
  // kept warm (vision/app.py), a cold start after any service (re)start
  // still pays the one-time ~20s load cost, so the indicator is a real
  // backstop, not just cosmetic.
  const [isGeneratingCaption, setIsGeneratingCaption] = useState(false)
  useEffect(() => {
    if (!isPictureLane || item.document_description !== null) {
      setIsGeneratingCaption(false)
      return
    }
    setIsGeneratingCaption(true)
    const POLL_INTERVAL_MS = 3500
    const POLL_WINDOW_MS = 30000
    const deadline = Date.now() + POLL_WINDOW_MS
    const id = window.setInterval(() => {
      if (Date.now() >= deadline) {
        window.clearInterval(id)
        setIsGeneratingCaption(false)
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
          <h3 className="mb-2 text-[11px] font-mono uppercase tracking-wide text-muted">{t('ops.review.document.heading')}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-[12px] text-muted sm:col-span-3">
              {t('ops.review.document.filenameLabel')}
              <input
                value={filename}
                disabled={!canResolve}
                onChange={(e) => setFilename(e.target.value)}
                className="mt-1 block h-9 w-full rounded-control border border-line px-2.5 text-[13px] text-ink outline-none focus:border-ink disabled:bg-canvas disabled:text-muted"
              />
            </label>
            <label className="text-[12px] text-muted sm:col-span-3">
              {t('ops.review.document.descriptionLabel')}
              <div className="mt-1 flex items-center gap-2">
                <input
                  value={description}
                  disabled={!canResolve}
                  placeholder={isPendingCaption ? t('ops.review.document.descriptionPendingPlaceholder') : undefined}
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
              {/* Backstop for the ~20s cold-start load cost after any
                 jaga-vision (re)start (2026-09-23, DECISIONS #58) — the
                 model is now kept warm so most requests are fast, but the
                 first one after a restart still pays that cost once, and
                 a bare empty field during that wait reads as broken
                 rather than "working on it." Scoped to the poll's own
                 active window (isGeneratingCaption), not just
                 isPendingCaption, so it disappears once the poll gives up
                 rather than showing forever. */}
              {isGeneratingCaption && (
                <span className="mt-1 flex items-center gap-1 text-[11px] text-muted">
                  <Loader2 size={11} className="animate-spin" /> {t('ops.review.document.generatingCaption')}
                </span>
              )}
            </label>
            <label className="text-[12px] text-muted">
              {t('ops.review.document.bucketLabel')}
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
              {t('ops.review.document.docTypeLabel')}
              <DocTypeField
                lane={item.document_lane}
                value={docType}
                disabled={!canResolve}
                onChange={setDocType}
                className={`mt-1 ${FIELD_CLASS}`}
              />
            </label>
            <label className="text-[12px] text-muted">
              {t('ops.review.document.vendorNameLabel')}
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
          <h3 className="mb-2 text-[11px] font-mono uppercase tracking-wide text-muted">{t('ops.review.extractedFieldsHeading')}</h3>
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
          <p className="text-[13px] text-red-700">{t('ops.review.expiredMessage')}</p>
          {canResolve ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => void archiveExpired()} disabled={busy} icon={<Archive size={14} />}>
                {t('ops.review.archiveButton')}
              </Button>
              {busy && <Loader2 size={16} className="animate-spin self-center text-muted" />}
              <span className="text-[12px] text-muted">{t('ops.review.archiveOrReupload')}</span>
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-muted">{t('ops.review.onlyAdminCanArchive')}</p>
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
              {Object.keys(edits).some((n) => edits[n] !== originalValue(n)) ? t('ops.review.acceptWithCorrections') : t('ops.review.acceptAsIs')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void resolve('reject')} disabled={busy} icon={<X size={14} />}>
              {t('ops.review.reject')}
            </Button>
            {busy && <Loader2 size={16} className="animate-spin self-center text-muted" />}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[12px] text-muted">{t('ops.review.onlyAdminCanResolve')}</p>
      )}
    </Card>
  )
}
