/** One document row/card, used by the Company Files and Search pages.
 * Moved out of OpsConsole.tsx verbatim (2026-09-23, header/nav restructure)
 * — content and behavior unchanged, only the file it lives in and where
 * its shared pieces now come from. */

import { ChevronDown, FileText, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { FileName } from '../../components/ui/FileName'
import { ApiError } from '../../lib/apiClient'
import { formatShortDate, localeFor } from '../../lib/dates'
import { startDownload } from '../../lib/download'
import { middleEllipsis } from '../../lib/filename'
import { canShowPdfInline } from '../../lib/pdfSupport'
import {
  BucketField,
  descriptionFor,
  FIELD_CLASS,
  StatusPill,
  VENDOR_NAMES_DATALIST_ID,
  VoiceCaptionButton,
  DocTypeField,
  bucketLabel,
  docTypeLabel,
  useDocumentBlobUrl,
} from './opsShared'
import { downloadHref, opsApi, type Bucket, type DocumentActivityEntry, type DocumentRow } from './opsApi'
import { isPurgeRequested, isRejectedDocument } from './documentStatus'
import { HistoryPanel } from './HistoryPanel'
import { useEditableDescription } from './useEditableDescription'

/** Small preview next to each row in the Documents list (2026-09-22, doc
 * 2's preview UX pass) — a photo is often more recognizable at a glance
 * than its filename. Images fetch the real file (small, via the shared
 * blob-URL hook). A PDF shows a picture of its first page since round 20 (item 5,
 * DECISIONS #97): a small JPEG the server renders on the first request and caches
 * (app/thumbnails.py). Until it arrives, and whenever there is none (it cannot be
 * rendered, or it is not the caller's to see), the generic file icon stays. Any other
 * type gets the icon and makes no request. */
export function DocumentThumbnail({ documentId, mediaType }: { documentId: number; mediaType: string }) {
  const isImage = mediaType.startsWith('image/')
  const isPdf = mediaType === 'application/pdf'
  const { blobUrl } = useDocumentBlobUrl(documentId, isImage || isPdf, isPdf ? 'thumbnail' : 'file')

  if (isImage || (isPdf && blobUrl)) {
    return (
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-control border border-line bg-canvas">
        {/* The top of a page is what identifies it, so a portrait page is cropped from the top. */}
        {blobUrl && <img src={blobUrl} alt="" className={`h-full w-full object-cover ${isPdf ? 'object-top' : ''}`} />}
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
 * Escape, the X, or a click on the backdrop, never a new tab.
 *
 * **A PDF on a browser with no PDF viewer of its own (Android Chrome and Brave)** is not drawn and not fetched here: an `<embed>` there
 * falls back to the browser's own "cannot preview" box (round 3, DECISIONS #121). What replaces it is ONE button, "Download PDF". A tap asks
 * the server for a short-lived, single-use link (`opsApi.createDownloadLink`) and follows it (`startDownload`); the server answers as an
 * attachment under the file's real name. It has to be a network download: on real Android Chrome and Brave (an Android emulator, with a
 * genuine touch) EVERY in-memory download, a `blob:` anchor with or without `download`, `blob:` through window.open and a `data:` URL,
 * was interrupted, on HTTP and HTTPS, while this kind completed on both (DECISIONS #122; it replaced round 3's blob hand-off, which
 * never worked on a phone: a genuine tap on that link failed exactly as the automatic click did, so the automatic click was never the
 * cause). Nothing starts by itself, and there is no "if nothing happens" copy because there is no first attempt to explain. Images and
 * desktop browsers are unchanged. */
export function DocumentViewerModal({
  doc,
  onClose,
}: {
  doc: Pick<DocumentRow, 'id' | 'filename' | 'media_type'>
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { id: documentId, filename, media_type: mediaType } = doc
  const handOff = mediaType === 'application/pdf' && !canShowPdfInline()
  // No bytes are fetched for a PDF that will be downloaded instead of drawn.
  const { blobUrl, failed } = useDocumentBlobUrl(documentId, !handOff)
  const [preparing, setPreparing] = useState(false)
  const [downloadFailed, setDownloadFailed] = useState(false)

  const download = async () => {
    setPreparing(true)
    setDownloadFailed(false)
    try {
      startDownload(downloadHref(await opsApi.createDownloadLink(documentId)))
    } catch {
      setDownloadFailed(true)
    } finally {
      setPreparing(false)
    }
  }

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
      aria-label={t('ops.documentViewer.previewLabel', { filename })}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-card bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <p className="min-w-0 flex-1 text-sm font-medium text-ink"><FileName name={filename} max={36} /></p>
          <button
            onClick={onClose}
            className="shrink-0 rounded-control p-1 text-muted hover:bg-canvas hover:text-ink"
            aria-label={t('ops.documentViewer.closePreview')}
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {failed && !handOff && <p className="text-[14px] text-red-700">{t('ops.documentViewer.loadFailed')}</p>}
          {!failed && !blobUrl && !handOff && <p className="text-[14px] text-muted">{t('ops.documentViewer.loading')}</p>}
          {blobUrl && mediaType === 'application/pdf' && !handOff && (
            <embed src={blobUrl} type="application/pdf" className="h-[70vh] w-full rounded-control border border-line" />
          )}
          {handOff && (
            <div className="space-y-4">
              <p className="text-[14px] leading-6 text-muted">{t('ops.documentViewer.noInlinePdf')}</p>
              {downloadFailed && <p className="text-[14px] text-red-700" role="alert">{t('ops.documentViewer.downloadFailed')}</p>}
              <Button size="md" disabled={preparing} onClick={() => void download()}>
                {t(preparing ? 'ops.documentViewer.preparing' : 'ops.documentViewer.downloadPdf')}
              </Button>
            </div>
          )}
          {blobUrl && mediaType.startsWith('image/') && (
            <img src={blobUrl} alt={`Source: ${filename}`} className="mx-auto max-h-[70vh] w-auto object-contain" />
          )}
        </div>
      </div>
    </div>
  )
}

/** A text action on a document card (View, Edit, Delete, Purge). Text, not a button look, but a 44px-tall tap target with side
 * padding (DECISIONS #108). Delete and Purge turn red on hover, which needs `!` to beat the muted colour's own hover here. */
const ACTION_CLASS =
  'inline-flex min-h-[44px] items-center whitespace-nowrap px-2 text-[13px] font-mono uppercase tracking-wide text-muted hover:text-ink'

/** One row in the Company Files / Search pages (2026-09-22: cards, not a
 * table — see DECISIONS #38). Owns its own edit-mode state, matching
 * ReviewQueueCard's fields (description/bucket/doc_type/vendor_name/
 * filename — DECISIONS #42 superseded the old tags input) and the same
 * disabled-vs-editing pattern. */
export function DocumentCard({
  doc,
  canEdit,
  canArchive,
  canRequestPurge = false,
  onView,
  onArchive,
  onRequestPurge,
  onCancelPurge,
  onSaved,
}: {
  doc: DocumentRow
  canEdit: boolean
  canArchive: boolean
  /** The owner's Purge (round 21, A5, DECISIONS #101): asks for this company document to be removed permanently. It
   * deletes nothing; it hides the document and tells the team. Owner only, and never on a personal file. */
  canRequestPurge?: boolean
  onView: () => void
  onArchive: () => void
  onRequestPurge?: () => void
  /** Takes a PENDING purge request back (round 3, item 9b, DECISIONS #121): offered on a purge-requested card, to the owner alone (the
   * same `canRequestPurge` rule that offers Purge). The document returns to the status it had; nothing was ever deleted. */
  onCancelPurge?: () => void
  onSaved: () => void
}) {
  const { t, i18n } = useTranslation()
  const [editing, setEditing] = useState(false)
  // 2026-09-24 (items 5/6): doc.description is JSON-encoded
  // {"en": "...", "<language>": "..."} — descriptionFor() reads back
  // whichever language is currently selected (falling back to English).
  const localDescription = descriptionFor(doc.description, i18n.language)
  // The card face above derives from localDescription on every render, so
  // it already follows the language selector by construction. This is the
  // edit form's own text — it follows the language too until the user
  // types (useEditableDescription, shared with ReviewQueueCard).
  const { description, setDescription, resetDescription } = useEditableDescription(doc.description)
  const [bucket, setBucket] = useState(doc.bucket ?? '')
  const [docType, setDocType] = useState(doc.doc_type ?? '')
  const [vendorName, setVendorName] = useState(doc.vendor_name ?? '')
  const [filename, setFilename] = useState(doc.filename)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  // Delete's one confirmation carries an owner-only "also remove it permanently" choice (DECISIONS #109): ticking it makes
  // the confirm a purge REQUEST instead of an ordinary delete. There is no separate Purge button or dialog any more.
  const [alsoPurge, setAlsoPurge] = useState(false)
  // The owner's purge request, still shown to them until the team removes the row (round 21, DECISIONS #102; round 5,
  // item 2, DECISIONS #125): read-only and marked, but Edit and Delete stay in place, disabled, rather than
  // disappearing — a document mid-request is not the same as one with nothing left to do. View and History both stay fully live
  // either way (round 5 found a "···" menu that was hidden while pending made what it held unreachable for exactly the documents
  // someone had just acted on; that menu is gone, and History is never gated on this).
  const purgePending = isPurgeRequested(doc)
  // The owner's "also remove it permanently" option in Delete's confirmation: the existing rule (canRequestPurge, never on a personal file), and
  // never on a document already waiting to be purged.
  const offerPurge = canRequestPurge && !!onRequestPurge && !purgePending
  const offerCancelPurge = canRequestPurge && !!onCancelPurge && purgePending
  const isPictureLane = doc.lane === 'memory'
  const isPendingCaption = isPictureLane && doc.description === null

  // History (round 6, DECISIONS #129; the same per-card expandable panel round 5 built for the AI trace, in the same place, with
  // different content): what people did to this document. The collapsed "History · N activities" line comes from
  // `doc.activity_summary`, already on the list response, so showing it costs no fetch; the entries themselves are fetched lazily,
  // once, only when this card's own panel is opened. Never gated on `purgePending`: the owner keeps their History on a document
  // with a purge request pending.
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [history, setHistory] = useState<DocumentActivityEntry[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const toggleHistory = async () => {
    const opening = !historyExpanded
    setHistoryExpanded(opening)
    if (opening && history === null && !historyLoading) {
      setHistoryLoading(true)
      setHistoryError(null)
      try {
        setHistory((await opsApi.getDocumentHistory(doc.id)).entries)
      } catch (e) {
        setHistoryError(e instanceof Error ? e.message : String(e))
      } finally {
        setHistoryLoading(false)
      }
    }
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      // 2026-09-23 (live regression report, item 6): picking "Photo" from
      // the Doc Type pills is now the only control for this — see
      // ReviewQueueCard.tsx's identical resolve() change for the full
      // reasoning. is_picture:true triggers the same server-side
      // lane/doc_type/bucket correction the old separate checkbox did.
      const wantsPictureCorrection = docType === 'photo' && !isPictureLane
      await opsApi.editDocument(doc.id, {
        description,
        language: i18n.language,
        bucket: (bucket || undefined) as Bucket | undefined,
        vendor_name: vendorName,
        filename,
        ...(wantsPictureCorrection ? { is_picture: true } : { doc_type: docType }),
      })
      setEditing(false)
      onSaved()
    } catch (e) {
      // 403 = the server refused this caller (app/auth.py::may_edit_document).
      // The Edit button is already hidden when the list said can_edit is
      // false, so this is only a race (ownership/role changed after the
      // page loaded) — but the server's message is English-only, so show a
      // translated one rather than an English sentence inside a Malay page.
      setError(
        e instanceof ApiError && e.status === 403
          ? t('ops.documents.editForbidden')
          : e instanceof Error ? e.message : String(e),
      )
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
              {localDescription ? (
                localDescription
              ) : isRejectedDocument(doc) ? (
                // A legacy rejected row has no description and, often, no lane or type either (features/ops/documentStatus.ts):
                // a title that says what it is, with the file name under it, instead of a card with nothing on it (DECISIONS #109).
                <span className="italic text-muted">{t('ops.documents.rejectedTitle')}</span>
              ) : isPendingCaption ? (
                <span className="italic text-muted">{t('ops.documents.noCaptionYet')}</span>
              ) : doc.lane || doc.doc_type ? (
                <span className="text-muted">{doc.lane ?? '-'} / {doc.doc_type ? docTypeLabel(t, doc.doc_type) : '-'}</span>
              ) : (
                <span className="text-muted">{middleEllipsis(doc.filename, 40)}</span>
              )}
            </p>
            {isRejectedDocument(doc) && !localDescription && (
              <p className="mt-0.5 break-words text-[13px] text-muted">{middleEllipsis(doc.filename, 40)}</p>
            )}
            {localDescription && (
              <p className="mt-0.5 break-words text-[13px] text-muted">{doc.lane ?? '-'} / {doc.doc_type ? docTypeLabel(t, doc.doc_type) : '-'}</p>
            )}
            {/* 2026-09-23, live user feedback: both dates already exist in
               the API response but neither was ever shown on this card —
               same exact "Upload date"/"Document date" wording as the
               Calendar page's Dates view (ops.dates.*), not a second,
               differently-worded copy of the same concept.
               2026-09-23 (live regression report, item 8): used to just
               slice the raw ISO string to YYYY-MM-DD — now the same
               locale-aware formatShortDate (lib/dates.ts) the Calendar
               page's own day heading already uses, not a second
               date-formatting approach. */}
            <p className="mt-0.5 break-words text-[13px] text-muted">
              {t('ops.dates.uploadDate')}: {formatShortDate(doc.received_at, localeFor(i18n.language))}
              {' · '}
              {t('ops.dates.documentDate')}: {doc.occurred_on ? formatShortDate(doc.occurred_on, localeFor(i18n.language)) : t('ops.documents.noDocumentDate')}
            </p>
            {doc.vendor_name && <p className="mt-0.5 break-words text-[13px] text-muted">{doc.vendor_name}</p>}
            {purgePending && (
              <p className="mt-1 break-words text-[13px] text-red-800" data-testid="purge-pending-note">{t('ops.documents.purgeRequest.pending')}</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusPill status={doc.status} />
          {doc.bucket && <Badge tone="neutral">{bucketLabel(t, doc.bucket)}</Badge>}
        </div>
      </div>

      {editing && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            placeholder={t('ops.documents.filenamePlaceholder')}
            className="block h-9 w-full rounded-control border border-line px-2.5 text-[14px] text-ink outline-none focus:border-ink sm:col-span-3"
          />
          <div className="flex items-center gap-2 sm:col-span-3">
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={isPendingCaption ? t('ops.review.document.descriptionPendingPlaceholder') : t('ops.documents.descriptionPlaceholder')}
              className="block h-9 w-full flex-1 rounded-control border border-line px-2.5 text-[14px] text-ink outline-none focus:border-ink"
            />
            {isPictureLane && <VoiceCaptionButton onCaption={setDescription} disabled={false} />}
          </div>
          <div className="sm:col-span-3">
            <BucketField
              value={bucket}
              disabled={false}
              onChange={setBucket}
              clearLabel={t('ops.documents.noBucketOption')}
            />
          </div>
          <div className="sm:col-span-3">
            {/* 2026-09-23 (live regression report, item 6): the separate
               "is this a picture?" checkbox is gone — picking "Photo" from
               these pills now IS the correction (save()'s
               wantsPictureCorrection sends is_picture:true), same as
               ReviewQueueCard.tsx. Still locks once already in memory
               lane, same one-directional correction as before. */}
            <DocTypeField lane={doc.lane} value={docType} disabled={isPictureLane} onChange={setDocType} className={FIELD_CLASS} />
            {isPictureLane && <p className="mt-1 text-[12px] text-muted">{t('ops.pictureToggle.docTypeLocked')}</p>}
            {docType === 'photo' && !isPictureLane && (
              <p className="mt-1 text-[12px] text-muted">{t('ops.pictureToggle.reducesAccuracy')}</p>
            )}
          </div>
          <input
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
            placeholder={t('ops.documents.vendorNamePlaceholder')}
            list={VENDOR_NAMES_DATALIST_ID}
            className="block h-9 w-full rounded-control border border-line px-2.5 text-[14px] text-ink outline-none focus:border-ink"
          />
          {error && <p className="text-[13px] text-red-700 sm:col-span-3">{error}</p>}
          <div className="flex gap-2 sm:col-span-3">
            <Button size="sm" onClick={() => void save()} disabled={busy}>{t('common.buttons.save')}</Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={busy}>{t('common.buttons.cancel')}</Button>
          </div>
        </div>
      )}

      {/* The row of text actions (DECISIONS #108). They stay text, not buttons, but each is a real 44px-tall tap target
         with padding either side (a 13px label with no padding was about 16px tall). Round 5, item 2 (DECISIONS #125):
         while a purge is pending, Edit and Delete stay in their normal places, DISABLED (greyed, `aria-disabled`, their
         own handlers refuse to run) rather than disappearing — a document mid-request still needs to be found in the
         same spot a person looks for it in. The "···" overflow menu this row used to end in is gone (round 5): its
         only item became the always-visible expandable panel below, which is never gated on purgePending at all. */}
      <div className="mt-1 flex flex-wrap items-center justify-between">
        <div className="-ml-2 mr-6 flex flex-wrap items-center gap-x-1">
          <button onClick={onView} className={ACTION_CLASS}>
            {t('ops.documents.view')}
          </button>
          {offerCancelPurge && (
            <button onClick={onCancelPurge} className={ACTION_CLASS}>
              {t('ops.documents.purgeRequest.cancel')}
            </button>
          )}
          {canEdit && !editing && (
            <button
              disabled={purgePending}
              aria-disabled={purgePending}
              onClick={() => {
                if (purgePending) return
                // Entering edit mode starts from what is on screen right now,
                // discarding any earlier edit's "user typed this" pin.
                resetDescription()
                setEditing(true)
              }}
              className={`${ACTION_CLASS} disabled:pointer-events-none disabled:opacity-40`}
            >
              {t('ops.documents.edit')}
            </button>
          )}
          {/* The "Pre-fill company settings from this" link that used to sit here (round 12,
             DECISIONS #79) moved into Company Settings itself in round 16 (DECISIONS #90):
             a business profile is no longer listed with the paperwork at all. */}
          {/* No doc.status !== 'archived' guard needed (2026-09-23, DECISIONS
             #53) — the server never sends an archived document to this list
             at all anymore, so every doc rendered here is guaranteed live.
             Renamed Archive -> Delete (2026-09-23, live user feedback): the
             app-facing behavior already is permanent deletion for every
             role including owner (DECISIONS #53 — only direct database
             access can undo it), so "Archive" implied a recoverability
             nobody using the app actually has. The endpoint/status name
             (`archiveDocument`, `status='archived'`) is deliberately
             unchanged — see its own comment in opsApi.ts. Gated behind
             ConfirmDialog below, not a single unconfirmed click. */}
          {canArchive && (
            <button
              disabled={purgePending}
              aria-disabled={purgePending}
              onClick={() => {
                if (purgePending) return
                setShowDeleteConfirm(true)
              }}
              className={`${ACTION_CLASS} hover:!text-red-700 disabled:pointer-events-none disabled:opacity-40 disabled:hover:!text-muted`}
            >
              {t('ops.documents.delete')}
            </button>
          )}
        </div>
      </div>

      {/* History (round 6, DECISIONS #129; round 5, items 3/6, DECISIONS #125 built this panel for the AI trace): a small,
         always-visible collapsed summary, never gated on purgePending, that expands IN PLACE on a tap and collapses on the next. */}
      <div className="mt-2 border-t border-line pt-2">
        <button
          type="button"
          onClick={() => void toggleHistory()}
          aria-expanded={historyExpanded}
          className="flex w-full items-center justify-between gap-2 py-1 text-left text-[12px] font-mono uppercase tracking-wide text-muted hover:text-ink"
        >
          <span>
            {doc.activity_summary
              ? t('ops.documents.history.summary', { count: doc.activity_summary.count })
              : t('ops.documents.history.summaryEmpty')}
          </span>
          <ChevronDown size={16} className={historyExpanded ? 'rotate-180 transition-transform' : 'transition-transform'} aria-hidden="true" />
        </button>
        {historyExpanded && (
          <div className="mt-2">
            {historyLoading && <p className="text-[14px] text-muted">{t('ops.documents.history.loading')}</p>}
            {historyError && <p className="text-[14px] text-red-700" role="alert">{t('ops.documents.history.loadFailed')}</p>}
            {history && <HistoryPanel entries={history} />}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        message={
          alsoPurge && offerPurge
            ? t('ops.documents.purgeRequest.message', { filename: middleEllipsis(doc.filename, 40) })
            : t('ops.documents.deleteConfirmMessage', { filename: middleEllipsis(doc.filename, 40) })
        }
        confirmLabel={alsoPurge && offerPurge ? t('ops.documents.purgeRequest.confirm') : t('common.buttons.delete')}
        cancelLabel={t('common.buttons.cancel')}
        onConfirm={() => {
          setShowDeleteConfirm(false)
          if (alsoPurge && offerPurge) onRequestPurge?.()
          else onArchive()
          setAlsoPurge(false)
        }}
        onCancel={() => {
          setShowDeleteConfirm(false)
          setAlsoPurge(false)
        }}
      >
        {/* Only the owner (the existing canRequestPurge rule, never on a personal file); anyone else sees the ordinary
           confirmation, unchanged. */}
        {offerPurge && (
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-[14px] text-ink">
            <input
              type="checkbox"
              checked={alsoPurge}
              onChange={(e) => setAlsoPurge(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-ink"
            />
            <span>{t('ops.documents.deleteAlsoPurge')}</span>
          </label>
        )}
      </ConfirmDialog>
    </Card>
  )
}
