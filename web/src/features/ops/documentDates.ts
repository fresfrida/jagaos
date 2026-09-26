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

/** What a document needs to be placed on a day: the two dates, and its lane (a picture is `memory`). */
export type DayFields = Pick<DocumentRow, 'received_at' | 'occurred_on'> & { lane?: string | null }

/** A picture (a photo in Memory Lane, whatever its EXIF said) is the one kind of document whose date the person did not type and no model read. */
export function isPicture(doc: { lane?: string | null }): boolean {
  return doc.lane === 'memory'
}

/** The day a document was uploaded, in the COMPANY's timezone (`received_at` is a real UTC timestamp), or null. The one place that turns it into a day. */
export function uploadDay(doc: Pick<DocumentRow, 'received_at'>, timezone: string): string | null {
  return doc.received_at ? dayInTimezone(doc.received_at, timezone) : null
}

/** The day a document falls on under `basis`, or null when the basis has no date for it. ONE function for the Calendar, the range filter and the card
 * (round 7, S1e, DECISIONS #138). A PICTURE with no `occurred_on` (a photo the browser's re-encoding stripped the EXIF from, and no date-taken came with)
 * falls back to its UPLOAD day under the 'document' basis, so it is never left out of a range; nothing is written for that (occurred_on stays null:
 * "the photo says" and "we guessed" are never mixed in the database). Every other document with no `occurred_on` still has no document day. */
export function documentDay(doc: DayFields, basis: DateBasis, timezone: string): string | null {
  if (basis === 'upload') return uploadDay(doc, timezone)
  if (doc.occurred_on) return doc.occurred_on.slice(0, 10)
  return isPicture(doc) ? uploadDay(doc, timezone) : null
}

/** The two dates a card shows, from the same rule. `fromUpload` is true when a picture's date is the fallback (no date-taken was known). */
export interface DisplayDates {
  upload: string | null
  document: string | null
  picture: boolean
  fromUpload: boolean
}

export function displayDates(doc: DayFields, timezone: string): DisplayDates {
  const picture = isPicture(doc)
  const document = documentDay(doc, 'document', timezone)
  return { upload: uploadDay(doc, timezone), document, picture, fromUpload: picture && !doc.occurred_on && document !== null }
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
export function filterByDateRange<T extends DayFields>(
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

/** What to say under the From and To inputs (DECISIONS #110): the range as it will be applied, so the person sees it in one fixed
 * format whatever their device shows inside the native date inputs. `key` picks the sentence (`ops.documents.filter.<key>`), `from`
 * and `to` are the ISO days to format. Null when there is nothing to say: no range, or a backwards one (which has its own warning). */
export type RangeEcho = { key: 'echoBoth' | 'echoFrom' | 'echoTo'; from: string; to: string }

export function rangeEcho(range: DateRange): RangeEcho | null {
  if (!rangeIsSet(range) || rangeIsBackwards(range)) return null
  if (range.from && range.to) return { key: 'echoBoth', from: range.from, to: range.to }
  return range.from ? { key: 'echoFrom', from: range.from, to: '' } : { key: 'echoTo', from: '', to: range.to }
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
