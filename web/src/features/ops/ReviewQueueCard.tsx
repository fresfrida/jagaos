/** One review-item card in the Upload & Review page's queue. Moved out of
 * OpsConsole.tsx verbatim (2026-09-23, header/nav restructure) — content
 * and behavior unchanged, only the file it lives in and where its shared
 * pieces (DocTypeField, VoiceCaptionButton, etc.) now come from. */

import { Archive, Check, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { ApiError } from '../../lib/apiClient'
import {
  BucketField,
  DATE_FIELD_NAMES,
  descriptionFor,
  dmyToIso,
  FIELD_CLASS,
  fieldLabel,
  isFileMissingReason,
  isInjectionBlockedReason,
  isoToDmy,
  parseReviewReasons,
  VENDOR_NAMES_DATALIST_ID,
  VoiceCaptionButton,
  DocTypeField,
  useDocumentBlobUrl,
} from './opsShared'
import { opsApi, type Bucket, type ReviewItem } from './opsApi'
import { ReviewReasons } from './ReviewReasons'
import { useEditableDescription } from './useEditableDescription'

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
  const { t, i18n } = useTranslation()
  const proposed = parseProposed(item.proposed_json)
  const fieldNames = Object.keys(proposed).filter((k) => k !== 'injection_suspected' && isProvenance(proposed[k]))
  // 2026-09-22 (DECISIONS #40): every document now needs review, even a
  // clean one, so the card must read differently for "routine confirm" vs
  // "actual flag" or every single upload looks like something went wrong.
  // 2026-09-23 (live regression report, items 7/8/10b): item.question is
  // now JSON-encoded structured reasons, not a sentence to substring-match
  // — parsed once here, isRoutine/isFileMissing derived from the array's
  // shape (empty / a lone file_missing entry) instead of exact-matching
  // item.reason's debug string.
  const reasons = parseReviewReasons(item.question)
  const isRoutine = reasons.length === 0
  const isFileMissing = isFileMissingReason(reasons)
  // 2026-09-23 (DECISIONS #68): a hard-quarantined document — nothing was
  // ever presented as trustworthy to confirm (proposed_json is "{}"), so
  // Accept has nothing to do; only Delete/Reject make sense.
  const isInjectionBlocked = isInjectionBlockedReason(reasons)

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
  // 2026-09-24 (items 5/6): item.document_description is JSON-encoded
  // {"en": "...", "<language>": "..."} — descriptionFor() reads back
  // whichever language is currently selected (falling back to English).
  const { description, setDescription } = useEditableDescription(item.document_description)
  const [bucket, setBucket] = useState(item.document_bucket ?? '')
  const [docType, setDocType] = useState(item.document_doc_type ?? '')
  // 2026-09-23 (live regression report, item 3): this used to initialize
  // from document_vendor_name alone — classify.py's separate, optional,
  // nullable counterparty guess ("leave it null if you can't tell") —
  // never reconciled with the invoice-lane extraction's own dedicated
  // `vendor` field (app/graph/extract.py's InvoiceFields, its own
  // confidence, shown a few sections below in "Extracted fields").
  // Confirmed live: extraction found a real vendor at 95% confidence, but
  // this field still showed blank, so the reviewer had to retype a value
  // that was already sitting right there. Extract's vendor now wins when
  // present; document_vendor_name is the fallback, not a second source
  // asked to agree with it.
  const proposedVendor = proposed.vendor
  const proposedVendorValue = isProvenance(proposedVendor) && typeof proposedVendor.value === 'string' ? proposedVendor.value : null
  const [vendorName, setVendorName] = useState(proposedVendorValue ?? item.document_vendor_name ?? '')
  const [filename, setFilename] = useState(item.document_filename)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const isPictureLane = item.document_lane === 'memory'
  // Distinguishes "no caption yet" (the is_picture upload path leaves
  // description NULL on purpose) from "someone deliberately cleared it" —
  // only meaningful while the field is still at its initial, unedited
  // value, same as any placeholder.
  const isPendingCaption = isPictureLane && item.document_description === null

  // 2026-09-23 (DECISIONS #56) / 2026-09-24 (items 5/6): the description
  // field follows a caption landing via a poll tick, and the selected
  // language, until the reviewer edits it — see useEditableDescription.

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
          language?: string
          bucket?: Bucket
          doc_type?: string
          vendor_name?: string
          filename?: string
          is_picture?: boolean
        } = {}
        // 2026-09-24 (items 5/6): compares against the parsed/localized
        // text, not the raw JSON column — item.document_description is
        // now {"en": "...", "<language>": "..."}. language sent alongside
        // so the backend merges the correction into just this one key
        // (app/main.py::edit_document), not overwrite every language.
        if (description !== descriptionFor(item.document_description, i18n.language)) {
          documentEdits.description = description
          documentEdits.language = i18n.language
        }
        if (bucket && bucket !== (item.document_bucket ?? '')) documentEdits.bucket = bucket as Bucket
        // 2026-09-23 (live regression report, item 6): picking "Photo" from
        // the Doc Type pills is now the only control for this — the
        // separate "is this a picture?" checkbox is gone (it answered the
        // exact same question DOC_TYPES' own 'photo' pill already did).
        // Sent as is_picture:true, not doc_type:'photo' — is_picture
        // already deterministically sets lane/doc_type/bucket together
        // server-side (DocumentEditRequest's docstring), so this triggers
        // that path rather than a plain doc_type update.
        const wantsPictureCorrection = docType === 'photo' && !isPictureLane
        if (wantsPictureCorrection) {
          documentEdits.is_picture = true
        } else if (docType !== (item.document_doc_type ?? '')) {
          documentEdits.doc_type = docType
        }
        if (vendorName !== (item.document_vendor_name ?? '')) documentEdits.vendor_name = vendorName
        if (filename !== item.document_filename) documentEdits.filename = filename
        if (Object.keys(documentEdits).length > 0) {
          await opsApi.editDocument(item.document_id, documentEdits)
        }
      }
      await opsApi.resolveReview(item.id, item.thread_id, { action, corrected_fields: correctedFields })
      if (action === 'reject') onRejected(item.document_filename)
      onResolved()
      // 2026-09-23 (live regression report, item 10): missing on this
      // success path — every other exit from this function (both catch
      // branches below) already resets it. Reproduced reject vs. delete
      // live side by side and found no visible discrepancy today (this
      // card unmounts via onResolved()'s refresh before a stale busy
      // state could ever render) — fixed anyway for correctness and
      // consistency with delete's own confirm-then-clear pattern, not
      // because a symptom was confirmed.
      setBusy(false)
    } catch (e) {
      if (e instanceof ApiError && e.status === 410) {
        // The in-memory LangGraph checkpoint is gone (server restart since
        // upload — docs/HANDOFF.md's known MemorySaver limitation). Accept
        // and Reject would both just fail again the same way.
        //
        // 2026-09-23 (live regression report, item 1): reject auto-completes
        // instead of showing the manual fallback prompt below — reject's
        // whole intent is "make this gone," so there's no reason to make
        // someone click a second button to finish what they already asked
        // for. Reuses the same archive endpoint the manual fallback calls,
        // just without waiting for another click. Confirm keeps the manual
        // fallback (setExpired below) — a corrected confirm can't be
        // silently auto-completed the same way, the correction itself
        // would be lost. The raw "backend restarted... checkpoint is gone"
        // detail stays in the network response for debugging either way,
        // never shown to the user.
        if (action === 'reject') {
          try {
            await opsApi.archiveDocument(item.document_id)
            onRejected(item.document_filename)
            onResolved()
          } catch (archiveError) {
            setError(archiveError instanceof Error ? archiveError.message : String(archiveError))
          }
          setBusy(false)
          return
        }
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
      {/* File-missing gets its own distinct, more severe headline
         (2026-09-23, live regression report items 1/2/6) — red, not the
         routine amber "please confirm" treatment, since there's nothing
         left to confirm the fields against; structurally can never
         render alongside a "no issues found"/isRoutine state, since
         app/graph/verify.py's file_missing check overrides every other
         reason rather than joining them. */}
      <ReviewReasons
        reasons={reasons}
        className={`text-[13px] font-medium ${isFileMissing ? 'text-red-700' : isRoutine ? 'text-muted' : 'text-amber-800'}`}
      />

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
                  <VoiceCaptionButton
                    onCaption={setDescription}
                    disabled={!canResolve}
                  />
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
            <label className="text-[12px] text-muted sm:col-span-3">
              {t('ops.review.document.bucketLabel')}
              <div className="mt-1">
                <BucketField
                  value={bucket}
                  disabled={!canResolve}
                  onChange={setBucket}
                  clearLabel={t('ops.documents.noBucketOption')}
                />
              </div>
            </label>
            <label className="text-[12px] text-muted sm:col-span-3">
              {t('ops.review.document.docTypeLabel')}
              {/* 2026-09-23 (live regression report, item 6): the separate
                 "is this a picture, not a document?" checkbox is gone —
                 it was a second control answering the exact same question
                 the Doc Type pills' own "Photo" option already does
                 (DOC_TYPES includes 'photo'). Picking Photo here now IS
                 the correction (resolve()'s wantsPictureCorrection sends
                 is_picture:true on save). Still locks once already in
                 memory lane — that part is unchanged, same one-directional
                 correction DocumentEditRequest's docstring describes. */}
              <DocTypeField
                lane={item.document_lane}
                value={docType}
                disabled={!canResolve || isPictureLane}
                onChange={setDocType}
                className={`mt-1 ${FIELD_CLASS}`}
              />
              {isPictureLane && <p className="mt-1 text-[11px] text-muted">{t('ops.pictureToggle.docTypeLocked')}</p>}
              {docType === 'photo' && !isPictureLane && (
                <p className="mt-1 text-[11px] text-muted">{t('ops.pictureToggle.reducesAccuracy')}</p>
              )}
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
          </div>
        </div>
      )}

      {!expired && fieldNames.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="mb-2 text-[11px] font-mono uppercase tracking-wide text-muted">{t('ops.review.extractedFieldsHeading')}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {fieldNames.map((name) => {
              // 2026-09-23 (live regression report, item 9): the raw
              // confidence percentage/flag next to each field ("87%", or
              // the "(please check)" flag below the floor) is gone
              // entirely — no confidence-tied wording anywhere the user
              // sees, matching item 7/8's same call on verify.py's
              // reasons. Confidence still exists in the data and still
              // drives review (DECISIONS #40's unconditional
              // needs_review) — this only ever changed what's displayed.
              //
              // 2026-09-23 (item 4): a date-shaped field (issued_on/
              // due_on) gets a masked DD/MM/YYYY input instead of the raw
              // ISO string a plain text box would show — a native
              // <input type="date"> can't guarantee that display format
              // across browsers/OSes (HTML5 only guarantees the
              // underlying value is ISO), so this is a real custom input,
              // not the native control.
              const isDateField = DATE_FIELD_NAMES.has(name)
              return (
                <label key={name} className="text-[12px] text-muted">
                  {fieldLabel(t, name)}
                  {isDateField ? (
                    <input
                      value={isoToDmy(edits[name] ?? '')}
                      disabled={!canResolve}
                      placeholder="DD/MM/YYYY"
                      onChange={(e) => {
                        const text = e.target.value
                        const iso = dmyToIso(text)
                        // Commits the parsed ISO once the text is a
                        // complete, valid DD/MM/YYYY — otherwise the input
                        // still shows exactly what was typed (via the
                        // isoToDmy(edits[name]) round-trip above only
                        // reflecting the last committed value would fight
                        // the user mid-keystroke), so store the raw text
                        // directly whenever it doesn't parse yet.
                        setEdits((prev) => ({ ...prev, [name]: iso ?? text }))
                      }}
                      className="mt-1 block h-9 w-full rounded-control border border-line px-2.5 text-[13px] text-ink outline-none focus:border-ink disabled:bg-canvas disabled:text-muted"
                    />
                  ) : (
                    <input
                      value={edits[name]}
                      disabled={!canResolve}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [name]: e.target.value }))}
                      className="mt-1 block h-9 w-full rounded-control border border-line px-2.5 text-[13px] text-ink outline-none focus:border-ink disabled:bg-canvas disabled:text-muted"
                    />
                  )}
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
              <Button size="sm" variant="secondary" onClick={() => setShowDeleteConfirm(true)} disabled={busy} icon={<Archive size={14} />}>
                {t('ops.review.deleteButton')}
              </Button>
              {busy && <Loader2 size={16} className="animate-spin self-center text-muted" />}
              <span className="text-[12px] text-muted">{t('ops.review.deleteOrReupload')}</span>
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-muted">{t('ops.review.onlyAdminCanDelete')}</p>
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
          {!isRoutine && (
            <ReviewReasons reasons={reasons} className={`mb-2 text-[13px] ${isFileMissing ? 'text-red-700' : 'text-amber-800'}`} />
          )}
          <div className="flex gap-2">
            {/* 2026-09-23 (DECISIONS #68): no Accept for a hard-quarantined
               document — proposed_json is "{}" (nothing was ever presented
               as trustworthy to confirm), so there's nothing for this
               button to do. Reject stays and doubles as the "Delete it"
               action the reason text names, no separate button needed —
               app/main.py::resolve_review detects the document is already
               'quarantined' and archives it directly server-side, rather
               than attempting the pipeline resume this document's run
               never paused for in the first place (confirmed live: that
               resume does NOT reliably 410 the way an actually-expired
               session does — see resolve_review's own comment). */}
            {!isInjectionBlocked && (
              <Button size="sm" onClick={() => void resolve('confirm')} disabled={busy} icon={<Check size={14} />}>
                {Object.keys(edits).some((n) => edits[n] !== originalValue(n)) ? t('ops.review.acceptWithCorrections') : t('ops.review.acceptAsIs')}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => void resolve('reject')} disabled={busy} icon={<X size={14} />}>
              {t('ops.review.reject')}
            </Button>
            {busy && <Loader2 size={16} className="animate-spin self-center text-muted" />}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[12px] text-muted">{t('ops.review.onlyAdminCanResolve')}</p>
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        message={t('ops.documents.deleteConfirmMessage', { filename: item.document_filename })}
        confirmLabel={t('common.buttons.delete')}
        cancelLabel={t('common.buttons.cancel')}
        busy={busy}
        onConfirm={() => {
          setShowDeleteConfirm(false)
          void archiveExpired()
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </Card>
  )
}
