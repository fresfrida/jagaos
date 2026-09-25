/** Google-Calendar-style month grid for the real Calendar page's Dates
 * section (2026-09-23) — replaces the previous flat scrolling list, which
 * didn't read as a calendar at all. A cell only ever shows a compact
 * count, never full entries (that's `DatesView`'s selected-day list,
 * below the grid) — cramming labels into a ~50px mobile cell isn't
 * readable at any font size. Not `WeekGrid.tsx` (the logged-out marketing
 * preview's time-of-day week view over mock meeting events) — a different
 * data model (real documents, by day only, no time-of-day) and a
 * different grid shape, so it's its own component rather than a forced
 * reuse. */

import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { cn } from '../../lib/cn'
import { addMonths, daysInMonth, localeFor, parseIsoDate, startOfMonth, todayInTimezone, toIsoDate } from '../../lib/dates'
import type { DocumentRow } from '../ops/opsApi'
import { MonthJump, type JumpLevel } from './MonthJump'
import { firstOfMonth as monthStart, shiftYearPage, yearPageStart, yearsOfPage } from './monthPaging'

/** Which picker, if any, the header has opened over the day grid. */
type Picker = { level: 'years'; start: number } | { level: 'months'; year: number } | null

function weekdayLabels(locale: string): string[] {
  const monday = new Date(2024, 0, 1) // a known Monday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d.toLocaleDateString(locale, { weekday: 'short' })
  })
}

interface MonthGridProps {
  month: string // any YYYY-MM-DD within the displayed month
  documentsByDay: Map<string, DocumentRow[]>
  selectedDay: string | null
  onSelectDay: (day: string) => void
  onMonthChange: (month: string) => void
  // 2026-09-24 (company-local dates, item 2): the company's own IANA
  // timezone (useAuth().company.timezone) — "today" must be the
  // company's today, not the viewing device's, so an admin traveling
  // still sees the same highlighted day everyone else on the team does.
  timezone: string
}

export function MonthGrid({ month, documentsByDay, selectedDay, onSelectDay, onMonthChange, timezone }: MonthGridProps) {
  const { i18n, t } = useTranslation()
  const locale = localeFor(i18n.language)
  const monthLabel = parseIsoDate(month).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const firstOfMonth = startOfMonth(month)
  const firstWeekday = (parseIsoDate(firstOfMonth).getDay() + 6) % 7 // Monday = 0
  const totalDays = daysInMonth(month)
  const todayIso = todayInTimezone(timezone)
  const [picker, setPicker] = useState<Picker>(null)
  const viewed = parseIsoDate(month)
  const today = parseIsoDate(todayIso)

  // Round 16 (item 8): the header is a button. Tapping it opens the year grid, a year
  // opens its months, a month jumps there and returns to the days. The chevrons follow
  // the level: month by month on the days, a page of years on the year grid, year by
  // year on the month grid. Tapping the header again goes back up a level.
  const titleFor = (): string => {
    if (picker?.level === 'years') {
      const years = yearsOfPage(picker.start)
      return `${years[0]} - ${years[years.length - 1]}`
    }
    if (picker?.level === 'months') return String(picker.year)
    return monthLabel
  }
  const step = (direction: -1 | 1) => {
    if (picker?.level === 'years') setPicker({ level: 'years', start: shiftYearPage(picker.start, direction) })
    else if (picker?.level === 'months') setPicker({ level: 'months', year: picker.year + direction })
    else onMonthChange(addMonths(month, direction))
  }
  const onTitle = () => {
    if (picker === null) setPicker({ level: 'years', start: yearPageStart(viewed.getFullYear()) })
    else if (picker.level === 'months') setPicker({ level: 'years', start: yearPageStart(picker.year) })
    else setPicker(null)
  }
  const jump: JumpLevel | null =
    picker === null ? null : picker.level === 'years' ? { level: 'years', years: yearsOfPage(picker.start) } : { level: 'months', year: picker.year }
  const stepLabels =
    picker?.level === 'years'
      ? ['ops.dates.prevYears', 'ops.dates.nextYears']
      : picker?.level === 'months'
        ? ['ops.dates.prevYear', 'ops.dates.nextYear']
        : ['ops.dates.prevMonth', 'ops.dates.nextMonth']

  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: totalDays }, (_, i) => {
      const d = parseIsoDate(firstOfMonth)
      return toIsoDate(new Date(d.getFullYear(), d.getMonth(), i + 1))
    }),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="overflow-hidden rounded-card border border-line bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h3 className="min-w-0 text-sm font-semibold capitalize tracking-tight text-ink">
          <button
            type="button"
            onClick={onTitle}
            aria-expanded={picker !== null}
            aria-label={t(picker === null ? 'ops.dates.pickMonth' : 'ops.dates.backToDays', { label: titleFor() })}
            // Bordered at rest, like the step buttons beside it (the shared secondary Button look), so it reads as
            // something to press before it is hovered (round 20, item 3).
            className="flex h-9 items-center gap-1.5 rounded-control border border-line bg-white px-3 transition-colors hover:border-ink/40"
          >
            <span className="truncate">{titleFor()}</span>
            <ChevronDown size={16} aria-hidden="true" className={cn('shrink-0 text-muted transition-transform', picker !== null && 'rotate-180')} />
          </button>
        </h3>
        <div className="flex gap-1.5">
          <Button variant="secondary" size="icon" aria-label={t(stepLabels[0] ?? '')} onClick={() => step(-1)} icon={<ChevronLeft size={18} />} />
          <Button variant="secondary" size="icon" aria-label={t(stepLabels[1] ?? '')} onClick={() => step(1)} icon={<ChevronRight size={18} />} />
        </div>
      </div>

      {jump !== null ? (
        <MonthJump
          view={jump}
          viewedYear={viewed.getFullYear()}
          viewedMonth={viewed.getMonth()}
          todayYear={today.getFullYear()}
          todayMonth={today.getMonth()}
          locale={locale}
          onPickYear={(year) => setPicker({ level: 'months', year })}
          onPickMonth={(year, monthIndex) => {
            onMonthChange(monthStart(year, monthIndex))
            setPicker(null)
          }}
        />
      ) : (
        <>
          <div className="grid grid-cols-7">
            {weekdayLabels(locale).map((label, i) => (
              <div key={i} className="border-b border-line px-1 py-1.5 text-center font-mono text-[11px] uppercase tracking-wide text-muted">
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              if (!day) return <div key={i} className="min-h-[44px] border-b border-r border-line bg-canvas/40 sm:min-h-[56px]" />
              const count = documentsByDay.get(day)?.length ?? 0
              const isToday = day === todayIso
              const isSelected = day === selectedDay
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onSelectDay(day)}
                  aria-current={isToday ? 'date' : undefined}
                  aria-pressed={isSelected}
                  className={cn(
                    // flex flex-col items-start (2026-09-23, live 375px bug report):
                    // the date number and count badge are two `display:flex` spans
                    // (block-level, since `flex` — not `inline-flex`); with no
                    // explicit vertical layout on their shared parent, a block box
                    // with no explicit width defaults to filling the *entire*
                    // available width of its non-flex containing block, so the
                    // count badge stretched edge-to-edge and visually overlapped
                    // the date number at narrow cell widths, worst on the
                    // ring-highlighted selected cell. items-start here sizes each
                    // flex item to its own content instead of stretching it.
                    'flex min-h-[44px] flex-col items-start gap-1 border-b border-r border-line p-1 text-left transition-colors hover:bg-canvas sm:min-h-[56px]',
                    isSelected && 'bg-canvas ring-1 ring-inset ring-ink',
                  )}
                >
                  <span className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[13px]', isToday ? 'bg-ink font-medium text-white' : 'text-ink')}>
                    {Number(day.slice(8))}
                  </span>
                  {count > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-sage px-1 font-mono text-[10px] font-medium text-white">
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
