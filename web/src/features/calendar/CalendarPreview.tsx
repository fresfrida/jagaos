import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { addDays, formatWeekRange } from '../../lib/dates'
import { AgendaList } from './AgendaList'
import { EventDetails } from './EventDetails'
import { WeekGrid } from './WeekGrid'
import { EVENTS, INITIAL_WEEK_START } from './mockEvents'

export function CalendarPreview() {
  const [weekStart, setWeekStart] = useState(INITIAL_WEEK_START)
  const [selectedId, setSelectedId] = useState<string | null>('e-supplier-review')
  const selected = EVENTS.find((e) => e.id === selectedId) ?? null
  const weekEnd = addDays(weekStart, 7)
  const weekEvents = EVENTS.filter((e) => e.date >= weekStart && e.date < weekEnd)

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight">{formatWeekRange(weekStart)}</h3>
          <p className="font-mono text-[11px] text-muted">{weekEvents.length} events · sample data</p>
        </div>
        <div className="flex gap-1.5">
          <Button variant="secondary" size="icon" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))} icon={<ChevronLeft size={20} />} />
          <Button variant="secondary" size="icon" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))} icon={<ChevronRight size={20} />} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_260px] lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-5">
        <div className="min-w-0">
          <div className="lg:hidden">
            <AgendaList weekStart={weekStart} events={weekEvents} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
          <div className="hidden lg:block">
            <WeekGrid weekStart={weekStart} events={weekEvents} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        </div>
        <EventDetails event={selected} />
      </div>
    </div>
  )
}
