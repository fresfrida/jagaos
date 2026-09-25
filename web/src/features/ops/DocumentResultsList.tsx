/** Renders a list of documents as DocumentCards, plus the trace table and
 * viewer modal any of them can open — shared by the Company Files and
 * Search pages (2026-09-23, header/nav restructure) so the "view/trace/
 * archive a document" wiring exists in one place rather than copy-pasted
 * into both. Archiving here calls opsApi directly and then `onSaved()`
 * (the caller's refresh/re-filter), same shape OpsConsole used to have
 * inline. */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '../../components/ui/Card'
import { middleEllipsis } from '../../lib/filename'
import { DocumentCard, DocumentViewerModal } from './DocumentCard'
import { opsApi, type DocumentRow, type TraceReport } from './opsApi'
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
  const [trace, setTrace] = useState<{ documentId: number; report: TraceReport } | null>(null)
  const [viewingDocument, setViewingDocument] = useState<DocumentRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const viewTrace = async (documentId: number) => {
    try {
      const report = await opsApi.getTrace(documentId)
      setTrace({ documentId, report })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

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
                  onTrace={() => void viewTrace(doc.id)}
                  onArchive={() => void archiveDocument(doc)}
                  onRequestPurge={() => void requestPurge(doc)}
                  onSaved={onSaved}
                />
              </div>
            )
          })}
        </div>
      )}

      {trace && (
        <section>
          <h2 className="mb-3 text-[12px] font-mono uppercase tracking-wide text-muted">
            {t('ops.documents.traceHeading', { documentId: trace.documentId, cost: trace.report.total_cost_usd.toFixed(4) })}
          </h2>
          <Card className="overflow-hidden p-0" interactive={false}>
            <table className="w-full text-left text-[13px]">
              <thead className="bg-canvas text-muted">
                <tr>
                  <th className="px-4 py-2 font-normal">{t('ops.documents.traceTable.node')}</th>
                  <th className="px-4 py-2 font-normal">{t('ops.documents.traceTable.model')}</th>
                  <th className="px-4 py-2 font-normal">{t('ops.documents.traceTable.tokens')}</th>
                  <th className="px-4 py-2 font-normal">{t('ops.documents.traceTable.cost')}</th>
                  <th className="px-4 py-2 font-normal">{t('ops.documents.traceTable.decision')}</th>
                </tr>
              </thead>
              <tbody>
                {trace.report.nodes.map((node, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-4 py-2 text-ink">{node.node}</td>
                    <td className="px-4 py-2 text-muted">{node.model ?? '-'}</td>
                    <td className="px-4 py-2 text-muted">
                      {node.input_tokens ?? '-'} / {node.output_tokens ?? '-'}
                    </td>
                    <td className="px-4 py-2 text-muted">{node.cost_usd ? `$${node.cost_usd.toFixed(5)}` : '-'}</td>
                    <td className="px-4 py-2 text-muted">{node.decision ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}

      {viewingDocument && (
        <DocumentViewerModal doc={viewingDocument} onClose={() => setViewingDocument(null)} />
      )}
    </div>
  )
}
