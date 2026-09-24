/** The year and month grids behind the Calendar's month header (2026-09-24, round
 * 16, item 8). Presentational: MonthGrid owns which level is open and where it
 * goes; this draws a grid of large buttons for the level it is given. Year grid:
 * four columns, six rows. Month grid: three columns, four rows, in the language's
 * own short month names. The month being viewed is outlined, today's is bold. */

import { cn } from '../../lib/cn'

export type JumpLevel =
  | { level: 'years'; years: number[] }
  | { level: 'months'; year: number }

function monthNames(locale: string): string[] {
  return Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(locale, { month: 'short' }))
}

const CELL = 'flex h-11 items-center justify-center rounded-control text-[13px] transition-colors hover:bg-canvas'

export function MonthJump({
  view,
  viewedYear,
  viewedMonth,
  todayYear,
  todayMonth,
  locale,
  onPickYear,
  onPickMonth,
}: {
  view: JumpLevel
  /** The year and 0-based month the calendar is showing now. */
  viewedYear: number
  viewedMonth: number
  todayYear: number
  todayMonth: number
  locale: string
  onPickYear: (year: number) => void
  onPickMonth: (year: number, monthIndex: number) => void
}) {
  if (view.level === 'years') {
    return (
      <div className="grid min-h-[280px] grid-cols-4 content-start gap-1 p-2" role="group" data-testid="year-grid">
        {view.years.map((year) => (
          <button
            key={year}
            type="button"
            onClick={() => onPickYear(year)}
            aria-pressed={year === viewedYear}
            className={cn(CELL, year === viewedYear ? 'ring-1 ring-ink' : '', year === todayYear ? 'font-semibold text-ink' : 'text-muted')}
          >
            {year}
          </button>
        ))}
      </div>
    )
  }

  const names = monthNames(locale)
  return (
    <div className="grid min-h-[280px] grid-cols-3 content-start gap-1 p-2" role="group" data-testid="month-grid">
      {names.map((name, monthIndex) => {
        const isViewed = view.year === viewedYear && monthIndex === viewedMonth
        const isToday = view.year === todayYear && monthIndex === todayMonth
        return (
          <button
            key={monthIndex}
            type="button"
            onClick={() => onPickMonth(view.year, monthIndex)}
            aria-pressed={isViewed}
            className={cn(CELL, 'h-14 capitalize', isViewed ? 'ring-1 ring-ink' : '', isToday ? 'font-semibold text-ink' : 'text-muted')}
          >
            {name}
          </button>
        )
      })}
    </div>
  )
}
