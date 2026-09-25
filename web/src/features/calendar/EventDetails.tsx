import { AnimatePresence, motion } from 'framer-motion'
import { MousePointerClick } from 'lucide-react'
import { EmptyState } from '../../components/ui/EmptyState'
import { SourceLabel } from '../../components/ui/SourceLabel'
import { formatShortDate, formatWeekday } from '../../lib/dates'
import type { CalendarEvent } from './types'
import { getEventRelations } from './eventRelations'
import { formatTimeRange } from './time'

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-2 font-mono text-[12px] uppercase tracking-wide text-muted">{title}</h4>
      {children}
    </div>
  )
}

export function EventDetails({ event }: { event: CalendarEvent | null }) {
  return (
    <aside aria-label="Event details" aria-live="polite" className="rounded-card border border-line bg-canvas p-4 sm:p-5">
      <AnimatePresence mode="wait" initial={false}>
        {event ? (
          <motion.div
            key={event.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-5"
          >
            <EventBody event={event} />
          </motion.div>
        ) : (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <EmptyState icon={<MousePointerClick size={22} />} title="Select an event" description="Related documents, decisions and people appear here." />
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  )
}

function EventBody({ event }: { event: CalendarEvent }) {
  const { documents, decisions } = getEventRelations(event)
  return (
    <>
      <div>
        <h3 className="text-lg font-semibold tracking-tight">{event.title}</h3>
        <p className="mt-1 font-mono text-[13px] text-muted">
          {formatWeekday(event.date)} {formatShortDate(event.date)} · {formatTimeRange(event.start, event.end)}
        </p>
      </div>
      <Group title="Related documents">
        {documents.length === 0 ? (
          <p className="text-[14px] text-muted">None linked.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {documents.map((d) => (
              <SourceLabel key={`${d.kind}:${d.label}`} kind={d.kind} label={d.label} />
            ))}
          </div>
        )}
      </Group>
      <Group title="Decisions">
        {decisions.length === 0 ? (
          <p className="text-[14px] text-muted">No decisions recorded.</p>
        ) : (
          <ul className="space-y-2">
            {decisions.map((m) => (
              <li key={m.id} className="text-[14px] leading-5 text-ink">
                {m.text}
              </li>
            ))}
          </ul>
        )}
      </Group>
      <Group title="People">
        <ul className="space-y-1.5">
          {event.people.map((p) => (
            <li key={p.name} className="flex items-baseline justify-between gap-3 text-[14px]">
              <span className="text-ink">{p.name}</span>
              <span className="text-muted">{p.role}</span>
            </li>
          ))}
        </ul>
      </Group>
    </>
  )
}
