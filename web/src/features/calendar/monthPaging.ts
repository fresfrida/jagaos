/** The pure part of jumping around the Calendar's month grid (2026-09-24, round 16,
 * item 8): which years a page of the year grid shows, and the first day of a chosen
 * month. The header tap opens the year grid, a year opens its months, a month
 * jumps there: three taps to any year in the page, and the page moves by its own
 * length with the chevrons for a year further away. */

import { toIsoDate } from '../../lib/dates'

export const YEARS_PER_PAGE = 24

/** The first year of the page that shows `anchorYear`: most of the page is the past
 * (a company's documents are mostly behind it), the rest is the near future. */
export function yearPageStart(anchorYear: number): number {
  return anchorYear - 17
}

export function yearsOfPage(start: number): number[] {
  return Array.from({ length: YEARS_PER_PAGE }, (_, i) => start + i)
}

export function shiftYearPage(start: number, direction: -1 | 1): number {
  return start + direction * YEARS_PER_PAGE
}

/** `YYYY-MM-01` for a year and a 0-based month index. */
export function firstOfMonth(year: number, monthIndex: number): string {
  return toIsoDate(new Date(year, monthIndex, 1))
}
