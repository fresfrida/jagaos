/** Which calendar day a document falls on, and a from/to range over those days (2026-09-25, round 21, A1 and A7,
 * DECISIONS #101). One rule for two readers: the Calendar's Dates view groups documents by it, and the Company Files and
 * Tags date-range filter keeps documents by it, so the two cannot disagree about what "the day of a document" means.
 *
 * Two bases, the ones the Calendar toggle has always had: 'upload' is `received_at`, a real UTC timestamp, so it is
 * read in the COMPANY's timezone (a file uploaded near UTC midnight is a different day for the company); 'document' is
 * `occurred_on`, a bare date the document itself carries (an invoice's issue date, a photo's EXIF date), which has no
 * time of day to convert and keeps its own calendar day, and is null when the document has none. */

import { dayInTimezone } from '../../lib/dates'
import type { DocumentRow } from './opsApi'

export type DateBasis = 'upload' | 'document'

/** A from/to range of calendar days, `''` meaning open on that side. Both ends are inclusive. */
export interface DateRange {
  from: string
  to: string
}

export const NO_RANGE: DateRange = { from: '', to: '' }

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** `raw` if it is a YYYY-MM-DD day, else `''`: a hand-edited link cannot smuggle anything else into a filter. */
export function parseDay(raw: string | null | undefined): string {
  return raw && DAY.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) ? raw : ''
}

export function parseBasis(raw: string | null | undefined): DateBasis {
  return raw === 'document' ? 'document' : 'upload'
}

/** The day a document falls on under `basis`, or null when the basis has no date for it. */
export function documentDay(
  doc: Pick<DocumentRow, 'received_at' | 'occurred_on'>,
  basis: DateBasis,
  timezone: string,
): string | null {
  if (basis === 'upload') return doc.received_at ? dayInTimezone(doc.received_at, timezone) : null
  return doc.occurred_on ? doc.occurred_on.slice(0, 10) : null
}

export function rangeIsSet(range: DateRange): boolean {
  return range.from !== '' || range.to !== ''
}

/** Both ends given and the start is after the end: nothing can be in it, and the page should say why. */
export function rangeIsBackwards(range: DateRange): boolean {
  return range.from !== '' && range.to !== '' && range.from > range.to
}

/** The documents whose day (under `basis`) is inside the range. An unset range keeps everything, including documents
 * with no date under `basis`; a set range drops those, since they cannot be placed in it. A backwards range keeps nothing: no day is
 * both on or after the start and on or before an earlier end, so it needs no rule of its own. */
export function filterByDateRange<T extends Pick<DocumentRow, 'received_at' | 'occurred_on'>>(
  documents: readonly T[],
  basis: DateBasis,
  range: DateRange,
  timezone: string,
): T[] {
  if (!rangeIsSet(range)) return [...documents]
  return documents.filter((doc) => {
    const day = documentDay(doc, basis, timezone)
    if (day === null) return false
    return (range.from === '' || day >= range.from) && (range.to === '' || day <= range.to)
  })
}

/** The filter as URL params, so a link from the Tags page (or a copied address) restores the same view. */
export function rangeToParams(basis: DateBasis, range: DateRange): Record<string, string> {
  if (!rangeIsSet(range)) return {}
  return {
    ...(range.from ? { from: range.from } : {}),
    ...(range.to ? { to: range.to } : {}),
    basis,
  }
}

export function rangeFromParams(params: URLSearchParams): { basis: DateBasis; range: DateRange } {
  return {
    basis: parseBasis(params.get('basis')),
    range: { from: parseDay(params.get('from')), to: parseDay(params.get('to')) },
  }
}
