/** Renders a list of documents as DocumentCards, plus the viewer modal any of them can open — shared by the Company
 * Files and Search pages (2026-09-23, header/nav restructure) so the "view/archive a document" wiring exists in one
 * place rather than copy-pasted into both. Archiving here calls opsApi directly and then `onSaved()` (the caller's
 * refresh/re-filter), same shape OpsConsole used to have inline. AI trace is no longer this list's concern (round 5,
 * items 3/6, DECISIONS #125): each `DocumentCard` fetches and expands its own trace in place now, not a sibling
 * block this component renders after the card that asked for it. */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { middleEllipsis } from '../../lib/filename'
import { DocumentCard, DocumentViewerModal } from './DocumentCard'
import { opsApi, type DocumentRow } from './opsApi'
import { documentIsEditable } from './opsShared'

export function DocumentResultsList({
  documents,
  canEdit,
  canArchive,
  canRequestPurge = false,
  highlightId = null,
  onSaved,
  emptyMessage,
}: {
  documents: DocumentRow[]
  canEdit: boolean
  canArchive: boolean
  /** Show the owner's Purge on each company document (round 21, A5, DECISIONS #101). */
  canRequestPurge?: boolean
  /** The document a link pointed at (DECISIONS #105): ringed, and scrolled to once it is in the list. */
  highlightId?: number | null
  onSaved: () => void
  emptyMessage: string
}) {
  const { t } = useTranslation()
  const highlightRef = useRef<HTMLDivElement | null>(null)
  // The list arrives after the page mounts, so scroll when the highlighted document first APPEARS, not on every refetch.
  const highlightPresent = highlightId !== null && documents.some((d) => d.id === highlightId)
  useEffect(() => {
    if (highlightPresent) highlightRef.current?.scrollIntoView({ block: 'center' })
  }, [highlightPresent])
  const [viewingDocument, setViewingDocument] = useState<DocumentRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const archiveDocument = async (doc: DocumentRow) => {
    try {
      await opsApi.archiveDocument(doc.id)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // The owner's Purge: nothing is deleted, the document is hidden and the team is told. The document leaves this list,
  // so the request is confirmed here, by name, or the click would look like it did nothing.
  const requestPurge = async (doc: DocumentRow) => {
    try {
      await opsApi.requestPurge(doc.id)
      setError(null)
      setNotice(t('ops.documents.purgeRequest.done', { filename: middleEllipsis(doc.filename, 40) }))
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // Round 3, item 9b (DECISIONS #121): the owner takes a pending request back. The document returns to the status it had and to every list
  // it left, so the list is refreshed and the request confirmed here, by name, or the click would look like it did nothing.
  const cancelPurge = async (doc: DocumentRow) => {
    try {
      await opsApi.cancelPurgeRequest(doc.id)
      setError(null)
      setNotice(t('ops.documents.purgeRequest.cancelled', { filename: middleEllipsis(doc.filename, 40) }))
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-8">
      {notice && (
        <div className="rounded-card border border-line bg-white px-4 py-3 text-sm text-ink" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      {documents.length === 0 ? (
        <p className="rounded-card border border-line bg-white p-6 text-sm text-muted">{emptyMessage}</p>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => {
            const highlighted = doc.id === highlightId
            return (
              <div
                key={doc.id}
                ref={highlighted ? highlightRef : undefined}
                aria-current={highlighted || undefined}
                className={highlighted ? 'rounded-card ring-2 ring-ink' : undefined}
              >
                <DocumentCard
                  doc={doc}
                  canEdit={documentIsEditable(canEdit, doc)}
                  canArchive={canArchive}
                  canRequestPurge={canRequestPurge && doc.visibility !== 'only_me'}
                  onView={() => setViewingDocument(doc)}
                  onArchive={() => void archiveDocument(doc)}
                  onRequestPurge={() => void requestPurge(doc)}
                  onCancelPurge={() => void cancelPurge(doc)}
                  onSaved={onSaved}
                />
              </div>
            )
          })}
        </div>
      )}

      {viewingDocument && (
        <DocumentViewerModal doc={viewingDocument} onClose={() => setViewingDocument(null)} />
      )}
    </div>
  )
}
