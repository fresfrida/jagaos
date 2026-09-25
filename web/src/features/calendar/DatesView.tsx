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
import { FileName } from '../../components/ui/FileName'
import { dayInTimezone, formatShortDate, localeFor, startOfMonth } from '../../lib/dates'
import { useAuth } from '../auth/AuthContext'
import { DocumentViewerModal } from '../ops/DocumentCard'
import { DateBasisToggle } from '../ops/DateBasisToggle'
import { documentDay, type DateBasis } from '../ops/documentDates'
import { DocumentTypeIcon, StatusPill, bucketLabel, formatDocumentLabel } from '../ops/opsShared'
import type { DocumentRow } from '../ops/opsApi'
import { MonthGrid } from './MonthGrid'

// The two date bases and the rule for which day a document falls on are shared with the Company Files date-range
// filter (features/ops/documentDates.ts, DateBasisToggle.tsx). History: Amendment 2 (2026-09-22, DECISIONS #43) fixed the
// toggle's wording as "Upload date" / "Document date"; round 16 (item 8, DECISIONS #90) renamed it "When filed" / "Document
// dates"; round 21 (A1, DECISIONS #101) renamed "When filed" to "Uploaded": the option has always grouped by received_at,
// and no column records when a review was confirmed, so "filed" over-promised. The document card's "Upload date: ..."
// line keeps its own keys (ops.dates.uploadDate / documentDate).

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
      className="flex w-full items-center gap-2 rounded-control border border-line bg-white px-3 py-2 text-left text-[14px] transition-colors hover:border-ink/40"
    >
      <DocumentTypeIcon mediaType={doc.media_type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ink">{formatDocumentLabel(doc, i18n.language) || t('ops.documents.noCaptionYet')}</span>
        <FileName name={doc.filename} max={34} className="block truncate text-[12px] text-muted" />
      </span>
      {doc.bucket && <Badge tone="neutral">{bucketLabel(t, doc.bucket)}</Badge>}
      <StatusPill status={doc.status} />
      <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden="true" />
    </button>
  )
}

export function DatesView({ documents }: { documents: DocumentRow[] }) {
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
      // 2026-09-24 (item 2): received_at is a real UTC timestamp, so it is bucketed through the company's timezone;
      // occurred_on is a bare date and keeps its own day (documentDay explains both).
      const day = documentDay(doc, basis, timezone)
      if (day === null) {
        withoutDate.push(doc)
        continue
      }
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
      <DateBasisToggle basis={basis} onChange={setBasis} className="mb-4" />

      {/* Round 16 (item 7): the month grid is always drawn. With no documents it used to
         be replaced by a text-only "none uploaded" box, so a new company saw no
         calendar at all; now that message is a small hint under the grid. */}
      <div className="space-y-4">
        <MonthGrid month={month} documentsByDay={byDay} selectedDay={selectedDay} onSelectDay={setSelectedDay} onMonthChange={setMonth} timezone={timezone} />

        {documents.length === 0 ? (
          <p className="text-[14px] text-muted" data-testid="no-documents-hint">{t('ops.dates.noneUploaded')}</p>
        ) : (
          <>
            <section>
              {selectedDay ? (
                <>
                  <h3 className="mb-2 text-[12px] font-mono uppercase tracking-wide text-muted">
                    {formatShortDate(selectedDay, localeFor(i18n.language))} ({selectedDocs.length})
                  </h3>
                  {selectedDocs.length === 0 ? (
                    <p className="rounded-card border border-line bg-white p-4 text-[14px] text-muted">{t('ops.dates.noneOnDay')}</p>
                  ) : (
                    <div className="space-y-1">
                      {selectedDocs.map((doc) => <DateGroupRow key={doc.id} doc={doc} onView={() => setViewingDocument(doc)} />)}
                    </div>
                  )}
                </>
              ) : (
                <p className="rounded-card border border-dashed border-line bg-white p-4 text-[14px] text-muted">{t('ops.dates.selectADay')}</p>
              )}
            </section>

            {basis === 'document' && noDate.length > 0 && (
              <section>
                <h3 className="mb-2 text-[12px] font-mono uppercase tracking-wide text-muted">
                  {t('ops.dates.noDocumentDate', { count: noDate.length })}
                </h3>
                <div className="space-y-1">
                  {noDate.map((doc) => <DateGroupRow key={doc.id} doc={doc} onView={() => setViewingDocument(doc)} />)}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {viewingDocument && (
        <DocumentViewerModal doc={viewingDocument} onClose={() => setViewingDocument(null)} />
      )}
    </div>
  )
}
