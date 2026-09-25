/** How big each word of the Search page's word cloud is drawn (round 21, A8, DECISIONS #101). Pure: the same terms always
 * give the same sizes, so the cloud does not reshuffle when the page redraws. Sizes run from MIN_PX to MAX_PX by where a word's
 * document count sits between the smallest and the largest count; when they are all equal the words are one size. The
 * words are ordered alphabetically (case-insensitively), which reads as a cloud rather than a ranking. */

import type { SearchTerm } from '../ops/opsApi'

export const MIN_PX = 14
export const MAX_PX = 30

export interface SizedTerm extends SearchTerm {
  px: number
}

export function sizeTerms(terms: readonly SearchTerm[]): SizedTerm[] {
  if (terms.length === 0) return []
  const counts = terms.map((t) => t.count)
  const low = Math.min(...counts)
  const high = Math.max(...counts)
  const mid = Math.round((MIN_PX + MAX_PX) / 2)
  return [...terms]
    .sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }))
    .map((t) => ({
      ...t,
      px: high === low ? mid : Math.round(MIN_PX + ((t.count - low) / (high - low)) * (MAX_PX - MIN_PX)),
    }))
}
