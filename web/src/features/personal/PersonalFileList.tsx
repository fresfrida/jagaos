/** The person's private files as PersonalFileCards, with the viewer for View and the delete-for-good call (round 21, A3,
 * DECISIONS #101). It replaces DocumentResultsList in Only me: a personal file has no trace, no bucket filter, no status. Delete is the
 * server's purge (DECISIONS #99), after the card has asked for the name to be typed. */

import { useState } from 'react'
import { DocumentViewerModal } from '../ops/DocumentCard'
import { opsApi, type DocumentRow } from '../ops/opsApi'
import { documentIsEditable } from '../ops/opsShared'
import { PersonalFileCard } from './PersonalFileCard'

export function PersonalFileList({
  documents, canEdit, onChanged, emptyMessage,
}: {
  documents: DocumentRow[]
  canEdit: boolean
  onChanged: () => void
  emptyMessage: string
}) {
  const [viewing, setViewing] = useState<DocumentRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const remove = async (doc: DocumentRow) => {
    try {
      await opsApi.purgeDocument(doc.id, doc.filename)
      setError(null)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}
      {documents.length === 0 ? (
        <p className="rounded-card border border-line bg-white p-6 text-sm text-muted">{emptyMessage}</p>
      ) : (
        documents.map((doc) => (
          <PersonalFileCard
            key={doc.id}
            doc={doc}
            canEdit={documentIsEditable(canEdit, doc)}
            onView={() => setViewing(doc)}
            onDelete={() => void remove(doc)}
            onSaved={onChanged}
          />
        ))
      )}
      {viewing && <DocumentViewerModal doc={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
