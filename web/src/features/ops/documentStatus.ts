/** Which documents the app treats as not really held (2026-09-25, DECISIONS #109): ONE rule, read by the Calendar's day list
 * (which leaves them out) and by the document card (which gives them a title), so the two cannot disagree about what a
 * rejected document is.
 *
 * `rejected` is a legacy state. Since DECISIONS #50 a reject goes straight through to `archived` inside the pipeline, and
 * archived documents are excluded from every list endpoint, so today's pipeline never leaves a row at `rejected`. An OLD row
 * from before that fix can still be there, with no description and nothing to show, so both consumers defend against it. */

import type { DocumentRow } from './opsApi'

export const REJECTED_STATUS = 'rejected'

export function isRejectedDocument(doc: Pick<DocumentRow, 'status'>): boolean {
  return doc.status === REJECTED_STATUS
}

/** The documents the Calendar may group by day and count: a rejected document is not one the company holds. */
export function documentsForCalendar<T extends Pick<DocumentRow, 'status'>>(documents: readonly T[]): T[] {
  return documents.filter((doc) => !isRejectedDocument(doc))
}

/** A document the OWNER asked to have purged, which the team has not yet removed (round 21, DECISIONS #102): the server sends it to the
 * owner alone, with this status, read-only. ONE rule for the card's marker and actions and for Company Files' "Purge requested" filter
 * (round 3, item 9a, DECISIONS #121), so the two cannot disagree about what is pending. */
export const PURGE_REQUESTED_STATUS = 'purge_requested'

export function isPurgeRequested(doc: Pick<DocumentRow, 'status'>): boolean {
  return doc.status === PURGE_REQUESTED_STATUS
}
