import { CalendarX } from 'lucide-react'
import { addDays, formatDayMonth, formatWeekday } from '../../lib/dates'
import { cn } from '../../lib/cn'
import { EmptyState } from '../../components/ui/EmptyState'
import type { CalendarEvent } from './types'
import { formatTimeRange } from './time'

interface AgendaListProps {
  weekStart: string
  events: CalendarEvent[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/** Below lg: the week as a day-by-day list. Only days with events appear. */
export function AgendaList({ weekStart, events, selectedId, onSelect }: AgendaListProps) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter((day) => events.some((e) => e.date === day))

  if (days.length === 0) {
    return <EmptyState icon={<CalendarX size={22} />} title="Nothing scheduled this week" description="Use the arrows to move to another week." />
  }

  return (
    <div className="space-y-5">
      {days.map((day) => (
        <section key={day} aria-label={`${formatWeekday(day, 'long')} ${formatDayMonth(day)}`}>
          <h3 className="mb-2 font-mono text-[11px] uppercase tracking-wide text-muted">
            {formatWeekday(day)} · {formatDayMonth(day)}
          </h3>
          <ul className="space-y-2">
            {events
              .filter((e) => e.date === day)
              .map((event) => {
                const selected = event.id === selectedId
                return (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(event.id)}
                      aria-pressed={selected}
                      className={cn(
                        'flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 rounded-control border px-3.5 py-2.5 text-left transition-colors duration-200',
                        selected ? 'border-ink bg-ink text-white' : 'border-line bg-white hover:border-ink/60',
                      )}
                    >
                      <span className="text-sm font-medium">{event.title}</span>
                      <span className={cn('shrink-0 font-mono text-[11px]', selected ? 'text-white/70' : 'text-muted')}>
                        {formatTimeRange(event.start, event.end)}
                      </span>
                    </button>
                  </li>
                )
              })}
          </ul>
        </section>
      ))}
    </div>
  )
}
