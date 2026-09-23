const MS_PER_DAY = 86_400_000

/** Parse `YYYY-MM-DD` as a local date (avoids the UTC shift of `new
 * Date(iso)`). Takes just the first 10 characters (2026-09-23, live
 * regression report item 8) — a real bug caught while wiring this into
 * DocumentCard.tsx/CalendarHub.tsx: `document.received_at` is a full
 * SQLite `datetime('now')` string ("2026-09-23 10:58:35", not a bare
 * date), and splitting THAT on '-' produces a NaN day component
 * ("23 10:58:35" isn't a number), silently rendering "Invalid Date"
 * everywhere — caught live via a screenshot, not assumed safe. Slicing
 * first means every caller can pass either a bare date or a full
 * timestamp without needing to know or care which. */
export function parseIsoDate(iso: string): Date {
  const [y = 1970, m = 1, d = 1] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function addDays(iso: string, days: number): string {
  return toIsoDate(new Date(parseIsoDate(iso).getTime() + days * MS_PER_DAY))
}

// i18n codes (web/src/i18n.ts) -> a BCP-47 tag Intl can format dates in
// (2026-09-23, live BM bug report: Calendar's selected-day heading always
// read in English regardless of the language switcher, since it called
// formatShortDate with no locale). MonthGrid.tsx had its own private copy
// of this same map for its month/weekday chrome — moved here as the one
// shared spot so both callers, and formatShortDate's other callers, stay
// in sync instead of drifting.
const INTL_LOCALE: Record<string, string> = { en: 'en-GB', zh: 'zh-SG', ta: 'ta-SG', ms: 'ms-MY' }

export function localeFor(language: string): string {
  return INTL_LOCALE[language] ?? 'en-GB'
}

/** `locale` defaults to 'en-GB' so existing callers that don't pass one
 * (the logged-out marketing preview's `EventDetails.tsx`/`MemoryCard.tsx`,
 * deliberately not localized — DECISIONS #57) keep their exact prior
 * output; the real Calendar page passes `localeFor(i18n.language)`. */
export function formatShortDate(iso: string, locale: string = 'en-GB'): string {
  return parseIsoDate(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatWeekday(iso: string, style: 'short' | 'long' = 'short'): string {
  return parseIsoDate(iso).toLocaleDateString('en-GB', { weekday: style })
}

export function formatDayMonth(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function formatWeekRange(startIso: string): string {
  const end = addDays(startIso, 6)
  const startDate = parseIsoDate(startIso)
  const endDate = parseIsoDate(end)
  const sameMonth = startDate.getMonth() === endDate.getMonth()
  const startText = sameMonth ? String(startDate.getDate()) : formatDayMonth(startIso)
  return `${startText} – ${formatDayMonth(end)} ${endDate.getFullYear()}`
}

/** First day of the month `iso` falls in, as `YYYY-MM-DD` (2026-09-23, Calendar month grid). */
export function startOfMonth(iso: string): string {
  const d = parseIsoDate(iso)
  return toIsoDate(new Date(d.getFullYear(), d.getMonth(), 1))
}

/** `iso` shifted by whole months, clamped to day 1 first so e.g. Jan 31 + 1 month can't skip to March. */
export function addMonths(iso: string, months: number): string {
  const d = parseIsoDate(startOfMonth(iso))
  return toIsoDate(new Date(d.getFullYear(), d.getMonth() + months, 1))
}

/** Number of days in the month `iso` falls in. */
export function daysInMonth(iso: string): number {
  const d = parseIsoDate(iso)
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}
