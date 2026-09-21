const MS_PER_DAY = 86_400_000

/** Parse `YYYY-MM-DD` as a local date (avoids the UTC shift of `new Date(iso)`). */
export function parseIsoDate(iso: string): Date {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function toIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function addDays(iso: string, days: number): string {
  return toIsoDate(new Date(parseIsoDate(iso).getTime() + days * MS_PER_DAY))
}

export function formatShortDate(iso: string): string {
  return parseIsoDate(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
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
