/** Groups documents by date (2026-09-22, doc 3's calendar wiring). Not
 * the logged-out marketing preview's CalendarPreview/WeekGrid at
 * /calendar (when signed out) — that models generic meetings with mock
 * data and no session; this is the real, session-scoped Calendar page's
 * "Dates" section, over real documents, reusing whatever list it's handed
 * rather than a new endpoint. Two date bases: received_at (upload
 * timestamp, always set) and occurred_on (the document's own date —
 * invoice/statutory issued_on, or EXIF for photos; not every document has
 * one — Amendment 2 requires saying so plainly rather than silently
 * dropping those documents from the view).
 *
 * Moved out of OpsConsole.tsx verbatim (2026-09-23, header/nav
 * restructure: this used to be the "Dates" tab's whole content, now it's
 * one section of the merged Calendar page alongside Obligations and Gap
 * Analysis).
 *
 * **Restyled 2026-09-23 (real, confirmed bug)**: this used to be a flat
 * scrolling list whose rows showed the raw, truncated filename
 * ("179014556051314855...") — not a calendar layout, and not a
 * meaningful label. Now a real month grid (`MonthGrid.tsx`, weeks as
 * rows, a compact count per day) with the tapped day's entries listed
 * below it, each row using the new shared `formatDocumentLabel` (vendor —
 * doc type, falling back to description, then doc type alone) as its
 * primary label, plus a small file-type icon. The upload/document toggle
 * keeps its existing behavior, just now sits above the grid instead of
 * above a flat list.
 *
 * **Second live 375px bug report, same day (DECISIONS #63)**: rows are
 * now real buttons opening the same `DocumentViewerModal` Company Files/
 * Search already use, instead of a dead `<div>`; the row also shows the
 * filename as small secondary text under the primary label (a live ask
 * for "filename + vendor... when available" — resolved as filename-as-
 * supporting-detail, not a return to filename-as-primary, see
 * `DateGroupRow`'s own docstring); the selected-day heading is now
 * locale-aware (`formatShortDate(day, localeFor(i18n.language))`) instead
 * of hardcoded `en-GB`; and the bucket badge is translated
 * (`bucketLabel`). */

import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../../components/ui/Badge'
import { dayInTimezone, formatShortDate, localeFor, startOfMonth } from '../../lib/dates'
import { useAuth } from '../auth/AuthContext'
import { DocumentViewerModal } from '../ops/DocumentCard'
import { DocumentTypeIcon, StatusPill, bucketLabel, formatDocumentLabel } from '../ops/opsShared'
import type { DocumentRow } from '../ops/opsApi'
import { MonthGrid } from './MonthGrid'

type DateBasis = 'upload' | 'document'

// Amendment 2 (2026-09-22, DECISIONS #43): these exact two labels, not
// "Received"/"Occurred" or any other wording — the toggle control itself
// (tabs here) was left "your call".
const DATE_BASIS_OPTIONS: { id: DateBasis; labelKey: string }[] = [
  { id: 'upload', labelKey: 'ops.dates.uploadDate' },
  { id: 'document', labelKey: 'ops.dates.documentDate' },
]

// 2026-09-23 (live 375px bug report): two fixes to the row itself.
// (1) It was a plain, non-interactive <div> — now a real <button> opening
// the same DocumentViewerModal Company Files/Search already use (via
// DocumentResultsList.tsx's identical viewingDocument-state pattern
// below), with a trailing chevron as the tap affordance. (2) The report
// also asked to show the filename alongside vendor/source "when
// available" — in real tension with formatDocumentLabel()'s whole reason
// for existing (DECISIONS #62: stop the raw-truncated-filename bug). This
// keeps formatDocumentLabel() as the primary label (that fix stays
// intact, and the function's contract is unchanged for any other caller)
// and adds the filename as small muted *secondary* text underneath — my
// reading of "show filename + vendor... when available" as filename-as-
// supporting-detail, not filename-as-primary-label again.
function DateGroupRow({ doc, onView }: { doc: DocumentRow; onView: () => void }) {
  const { t, i18n } = useTranslation()
  return (
    <button
      type="button"
      onClick={onView}
      className="flex w-full items-center gap-2 rounded-control border border-line bg-white px-3 py-2 text-left text-[13px] transition-colors hover:border-ink/40"
    >
      <DocumentTypeIcon mediaType={doc.media_type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ink">{formatDocumentLabel(doc, i18n.language) || t('ops.documents.noCaptionYet')}</span>
        <span className="block truncate text-[11px] text-muted">{doc.filename}</span>
      </span>
      {doc.bucket && <Badge tone="neutral">{bucketLabel(t, doc.bucket)}</Badge>}
      <StatusPill status={doc.status} />
      <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden="true" />
    </button>
  )
}

export function DatesView({ documents, onChanged }: { documents: DocumentRow[]; onChanged?: () => void }) {
  const { t, i18n } = useTranslation()
  const { company } = useAuth()
  // 2026-09-24 (company-local dates, item 2): every company row has a
  // real timezone now (backend default 'Asia/Singapore'), so the fallback
  // here is just defensive against a not-yet-loaded company on first
  // render, not a real legacy-data case.
  const timezone = company?.timezone ?? 'Asia/Singapore'
  const [basis, setBasis] = useState<DateBasis>('upload')
  const [month, setMonth] = useState(() => startOfMonth(dayInTimezone(new Date().toISOString(), timezone)))
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [viewingDocument, setViewingDocument] = useState<DocumentRow | null>(null)

  const { byDay, noDate } = useMemo(() => {
    const map = new Map<string, DocumentRow[]>()
    const withoutDate: DocumentRow[] = []
    for (const doc of documents) {
      const raw = basis === 'upload' ? doc.received_at : doc.occurred_on
      if (!raw) {
        withoutDate.push(doc)
        continue
      }
      // 2026-09-24 (item 2): received_at is a real UTC timestamp (time of
      // day matters — a document uploaded near UTC midnight can fall on
      // the previous UTC calendar day vs. the company's own), so it's
      // bucketed through the company's timezone. occurred_on is already a
      // bare date (an invoice's issued_on, EXIF date) with no time-of-day
      // to convert — its own calendar day is unambiguous regardless of
      // timezone, so it keeps the plain prefix slice.
      const day = basis === 'upload' ? dayInTimezone(raw, timezone) : raw.slice(0, 10)
      const existing = map.get(day)
      if (existing) existing.push(doc)
      else map.set(day, [doc])
    }
    return { byDay: map, noDate: withoutDate }
  }, [documents, basis, timezone])

  // Switching basis regroups documents onto different days entirely — a
  // previously-selected day may no longer mean anything under the new basis.
  useEffect(() => setSelectedDay(null), [basis])

  const selectedDocs = selectedDay ? byDay.get(selectedDay) ?? [] : []

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
        <div className="space-y-4">
          <MonthGrid month={month} documentsByDay={byDay} selectedDay={selectedDay} onSelectDay={setSelectedDay} onMonthChange={setMonth} timezone={timezone} />

          <section>
            {selectedDay ? (
              <>
                <h3 className="mb-2 text-[11px] font-mono uppercase tracking-wide text-muted">
                  {formatShortDate(selectedDay, localeFor(i18n.language))} ({selectedDocs.length})
                </h3>
                {selectedDocs.length === 0 ? (
                  <p className="rounded-card border border-line bg-white p-4 text-[13px] text-muted">{t('ops.dates.noneOnDay')}</p>
                ) : (
                  <div className="space-y-1">
                    {selectedDocs.map((doc) => <DateGroupRow key={doc.id} doc={doc} onView={() => setViewingDocument(doc)} />)}
                  </div>
                )}
              </>
            ) : (
              <p className="rounded-card border border-dashed border-line bg-white p-4 text-[13px] text-muted">{t('ops.dates.selectADay')}</p>
            )}
          </section>

          {basis === 'document' && noDate.length > 0 && (
            <section>
              <h3 className="mb-2 text-[11px] font-mono uppercase tracking-wide text-muted">
                {t('ops.dates.noDocumentDate', { count: noDate.length })}
              </h3>
              <div className="space-y-1">
                {noDate.map((doc) => <DateGroupRow key={doc.id} doc={doc} onView={() => setViewingDocument(doc)} />)}
              </div>
            </section>
          )}
        </div>
      )}

      {viewingDocument && (
        <DocumentViewerModal doc={viewingDocument} onClose={() => setViewingDocument(null)} onChanged={onChanged} />
      )}
    </div>
  )
}
