/** The compliance checklist, in Company Settings since round 21 (A2, DECISIONS #101; it was a section of the
 * Calendar page from 2026-09-24, round 16, item 9, and called "gap analysis" until then; the Calendar now shows
 * only a one-line count, ChecklistSummary). One row per document a company event says it
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
import { Button } from '../../components/ui/Button'
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
      <h2 className="text-[12px] font-mono uppercase tracking-wide text-muted">
        {t('ops.gaps.heading', { satisfied, total: expectations.length })}
      </h2>
      {expectations.length > 0 && (
        <div
          className="mb-3 mt-2 h-1 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={expectations.length}
          aria-valuenow={satisfied}
          aria-label={t('ops.gaps.heading', { satisfied, total: expectations.length })}
        >
          <div className="h-full rounded-full bg-sage transition-[width] duration-300" style={{ width: `${(satisfied / expectations.length) * 100}%` }} />
        </div>
      )}
      <Card className="overflow-hidden p-0" interactive={false}>
        {expectations.length === 0 ? (
          <p className="p-6 text-sm text-muted">{t('ops.gaps.empty')}</p>
        ) : (
          <ul className="divide-y divide-line">
            {/* One compact row per item. From `sm` up: the name on the left and a fixed pair of slots on the right (status pill, then one quiet
               action) in the same place on every row. Below `sm` (a phone): the name on its own full-width line, then the pill on the left and
               the action on the right of one centred line, so a long name is never squeezed into a narrow column. */}
            {expectations.map((exp) => {
              const evidence =
                exp.status === 'satisfied' && exp.evidence_document_id != null
                  ? documents.find((d) => d.id === exp.evidence_document_id) ?? null
                  : null
              return (
                <li key={exp.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-2 pl-4 pr-2 sm:flex-nowrap sm:py-1.5" data-testid="checklist-row">
                  <p className="min-w-0 basis-full break-words text-[14px] font-medium text-ink sm:flex-1 sm:basis-0">{exp.label}</p>
                  <span className="flex shrink-0 justify-start sm:w-[6.25rem]">
                    <StatusPill status={exp.status} />
                  </span>
                  <span className="ml-auto flex shrink-0 justify-end sm:w-16">
                    {evidence && (
                      <Button variant="ghost" size="sm" className="px-2.5" onClick={() => setViewing(evidence)} aria-label={t('ops.gaps.viewDocument')}>
                        {t('ops.gaps.view')}
                      </Button>
                    )}
                    {exp.status === 'missing' && canUpload && (
                      <ButtonLink href={uploadHrefFor(exp.doc_type)} variant="ghost" size="sm" className="px-2.5">
                        {t('ops.gaps.upload')}
                      </ButtonLink>
                    )}
                  </span>
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
