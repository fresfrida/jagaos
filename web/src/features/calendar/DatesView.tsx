/** Groups documents by date (2026-09-22, doc 3's calendar wiring). Not
 * the logged-out marketing preview's CalendarPreview/WeekGrid at
 * /calendar (when signed out) — that models generic meetings with mock
 * data and no session; this is the real, session-scoped Calendar page's
 * "Dates" section, over real documents, reusing whatever list it's handed
 * rather than a new endpoint. Two date bases: received_at (upload
 * timestamp, always set) and occurred_on (the document's own date —
 * invoice/statutory issued_on, or EXIF for photos; not every document has
 * one — Amendment 2 requires saying so plainly rather than silently
 * dropping those documents from the view). A flat grouped/sorted list,
 * deliberately no week/day grid or drag-and-drop.
 *
 * Moved out of OpsConsole.tsx verbatim (2026-09-23, header/nav
 * restructure: this used to be the "Dates" tab's whole content, now it's
 * one section of the merged Calendar page alongside Obligations and Gap
 * Analysis) — content and behavior unchanged. */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../../components/ui/Badge'
import { StatusPill } from '../ops/opsShared'
import type { DocumentRow } from '../ops/opsApi'

type DateBasis = 'upload' | 'document'

// Amendment 2 (2026-09-22, DECISIONS #43): these exact two labels, not
// "Received"/"Occurred" or any other wording — the toggle control itself
// (tabs here) was left "your call".
const DATE_BASIS_OPTIONS: { id: DateBasis; labelKey: string }[] = [
  { id: 'upload', labelKey: 'ops.dates.uploadDate' },
  { id: 'document', labelKey: 'ops.dates.documentDate' },
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

export function DatesView({ documents }: { documents: DocumentRow[] }) {
  const { t } = useTranslation()
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
              {t(opt.labelKey)}
            </button>
          )
        })}
      </div>

      {documents.length === 0 ? (
        <p className="rounded-card border border-line bg-white p-6 text-sm text-muted">{t('ops.dates.noneUploaded')}</p>
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
                {t('ops.dates.noDocumentDate', { count: noDate.length })}
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
