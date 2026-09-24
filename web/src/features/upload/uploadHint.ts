/** The compliance-checklist "Upload" action's hint (2026-09-24, round 16, DECISIONS
 * #90). A MISSING checklist row links to the Upload page with the row's doc_type
 * slug in `?for=`; the page shows which item the upload is for and sends the slug
 * along as a hint to the classifier. Pure so the parsing and the label lookup are
 * testable; the page owns the state. The server ignores any slug that is not a real
 * checklist item, and the person can still change everything in the review card. */

import type { Expectation } from '../ops/opsApi'
import { routeHref } from '../../router/routes'

const HINT_PARAM = 'for'
const SLUG = /^[a-z0-9_]{1,60}$/

/** The slug in a location.search string, or null when absent or not slug-shaped. */
export function hintSlugFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get(HINT_PARAM)
  return raw !== null && SLUG.test(raw) ? raw : null
}

/** The Upload page's address for filing against one checklist item. */
export function uploadHrefFor(docTypeSlug: string): string {
  return `${routeHref('upload')}?${HINT_PARAM}=${encodeURIComponent(docTypeSlug)}`
}

/** The label of the company's checklist item with this slug, or null when it has none
 * (a stale or made-up link), in which case the page treats there as being no hint. */
export function hintLabel(slug: string | null, expectations: Pick<Expectation, 'doc_type' | 'label'>[]): string | null {
  if (slug === null) return null
  return expectations.find((e) => e.doc_type === slug)?.label ?? null
}
