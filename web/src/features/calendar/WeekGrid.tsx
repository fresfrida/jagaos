import { addDays, formatDayMonth, formatWeekday } from '../../lib/dates'
import { cn } from '../../lib/cn'
import type { CalendarEvent } from './types'
import { DAY_END_HOUR, DAY_START_HOUR, HOUR_HEIGHT_PX, eventPosition, formatTimeRange } from './time'
import { MOCK_TODAY } from './mockEvents'

interface WeekGridProps {
  weekStart: string
  events: CalendarEvent[]
  selectedId: string | null
  onSelect: (id: string) => void
}

const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i)
const COLUMNS = 'grid grid-cols-[3rem_repeat(7,minmax(0,1fr))]'

/** Desktop weekly grid: seven day columns, hour rows, events placed by time. */
export function WeekGrid({ weekStart, events, selectedId, onSelect }: WeekGridProps) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  return (
    <div role="group" aria-label="Week view" className="overflow-hidden rounded-card border border-line bg-white">
      <div className={cn(COLUMNS, 'border-b border-line')}>
        <div />
        {days.map((day) => (
          <div key={day} className="border-l border-line px-2 py-2.5 text-center">
            <p className="font-mono text-[11px] uppercase tracking-wide text-muted">{formatWeekday(day)}</p>
            <p
              className={cn(
                'mx-auto mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[14px]',
                day === MOCK_TODAY ? 'bg-ink font-medium text-white' : 'text-ink',
              )}
              aria-label={day === MOCK_TODAY ? `${formatDayMonth(day)}, today` : formatDayMonth(day)}
            >
              {Number(day.slice(8))}
            </p>
          </div>
        ))}
      </div>

      <div className={COLUMNS}>
        <div>
          {HOURS.map((hour) => (
            <div key={hour} style={{ height: HOUR_HEIGHT_PX }} className="pr-2 pt-1 text-right font-mono text-[11px] text-muted">
              {String(hour).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {days.map((day) => (
          <div key={day} className="relative border-l border-line">
            {HOURS.map((hour) => (
              <div key={hour} style={{ height: HOUR_HEIGHT_PX }} className="border-t border-line first:border-t-0" />
            ))}
            {events
              .filter((e) => e.date === day)
              .map((event) => {
                const { top, height } = eventPosition(event.start, event.end)
                const selected = event.id === selectedId
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => onSelect(event.id)}
                    aria-pressed={selected}
                    aria-label={`${event.title}, ${formatWeekday(event.date, 'long')} ${formatDayMonth(event.date)}, ${formatTimeRange(event.start, event.end)}`}
                    style={{ top, height }}
                    className={cn(
                      'absolute inset-x-1 cursor-pointer overflow-hidden rounded-md border px-2 py-1 text-left transition-colors duration-200',
                      selected ? 'border-ink bg-ink text-white' : 'border-line bg-canvas text-ink hover:border-ink/60',
                    )}
                  >
                    <span className="block break-words text-[13px] font-medium leading-4">{event.title}</span>
                    <span className={cn('block font-mono text-[11px]', selected ? 'text-white/70' : 'text-muted')}>
                      {formatTimeRange(event.start, event.end)}
                    </span>
                  </button>
                )
              })}
          </div>
        ))}
      </div>
    </div>
  )
}
