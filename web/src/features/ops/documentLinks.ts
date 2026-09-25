/** A link to one document inside Company Files (2026-09-25, DECISIONS #105). The Calendar's day list builds it and Company
 * Files reads it, so the parameter's name and what counts as a valid value live here once. */

import { routeHref } from '../../router/routes'

const DOCUMENT_PARAM = 'doc'

export function companyFilesDocumentHref(documentId: number): string {
  return `${routeHref('company-files')}?${new URLSearchParams({ [DOCUMENT_PARAM]: String(documentId) })}`
}

/** The document a link points at, or null. Only a positive whole number counts: a hand-edited link cannot smuggle anything else in. */
export function documentIdFromParams(params: URLSearchParams): number | null {
  const raw = params.get(DOCUMENT_PARAM)
  return raw !== null && /^[1-9]\d*$/.test(raw) ? Number(raw) : null
}
