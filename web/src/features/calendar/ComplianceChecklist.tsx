/** The compliance checklist on the Calendar page (2026-09-24, round 16, item 9;
 * called "gap analysis" until then). One row per document a company event says it
 * should hold, with whether it does.
 *
 * A SATISFIED row links to the document that satisfied it and opens it in the same
 * lightbox as everywhere else. The link comes from the row's `evidence_document_id`
 * and is offered only when that document is in the list this caller was sent (a
 * pending colleague's upload or a deleted file is not, so no dead link). A MISSING row
 * offers "Upload" to whoever may upload: it opens the Upload page with the item's
 * doc_type as a hint, which the classifier may use and the person may override. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { uploadHrefFor } from '../upload/uploadHint'
import { ButtonLink } from '../../components/ui/ButtonLink'
import { Card } from '../../components/ui/Card'
import { DocumentViewerModal } from '../ops/DocumentCard'
import type { DocumentRow, Expectation } from '../ops/opsApi'
import { StatusPill } from '../ops/opsShared'

export function ComplianceChecklist({
  expectations,
  documents,
  canUpload,
}: {
  expectations: Expectation[]
  documents: DocumentRow[]
  canUpload: boolean
}) {
  const { t } = useTranslation()
  const [viewing, setViewing] = useState<DocumentRow | null>(null)
  const satisfied = expectations.filter((e) => e.status === 'satisfied').length

  return (
    <section>
      <h2 className="mb-3 text-[11px] font-mono uppercase tracking-wide text-muted">
        {t('ops.gaps.heading', { satisfied, total: expectations.length })}
      </h2>
      <Card className="overflow-hidden p-0" interactive={false}>
        {expectations.length === 0 ? (
          <p className="p-6 text-sm text-muted">{t('ops.gaps.empty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {expectations.map((exp) => {
              const evidence =
                exp.status === 'satisfied' && exp.evidence_document_id != null
                  ? documents.find((d) => d.id === exp.evidence_document_id) ?? null
                  : null
              return (
                <li key={exp.id} className="px-4 py-3" data-testid="checklist-row">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 break-words text-[13px] font-medium text-ink">{exp.label}</p>
                    <StatusPill status={exp.status} />
                  </div>
                  {evidence && (
                    <button
                      type="button"
                      onClick={() => setViewing(evidence)}
                      className="mt-1 text-[12px] text-ink underline underline-offset-2 hover:text-muted"
                    >
                      {t('ops.gaps.viewDocument')}
                    </button>
                  )}
                  {exp.status === 'missing' && canUpload && (
                    <ButtonLink href={uploadHrefFor(exp.doc_type)} variant="secondary" size="sm" className="mt-2">
                      {t('ops.gaps.upload')}
                    </ButtonLink>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {viewing && <DocumentViewerModal doc={viewing} onClose={() => setViewing(null)} />}
    </section>
  )
}
