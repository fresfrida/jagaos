import type { Memory } from '../../features/memories/types'
import { TAGS } from '../../features/memories/mockData'
import { formatShortDate } from '../../lib/dates'
import { Badge } from './Badge'
import { Card } from './Card'
import { SourceLabel } from './SourceLabel'

/** One remembered fact: text, tags, dated source references. Used by search results and the tag list. */
export function MemoryCard({ memory, compact = false }: { memory: Memory; compact?: boolean }) {
  return (
    <Card className={compact ? 'p-3.5' : 'p-4'}>
      <p className="text-sm leading-6 text-ink">{memory.text}</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {memory.sources.map((s) => (
          <SourceLabel key={s.label} kind={s.kind} label={s.label} />
        ))}
        <time dateTime={memory.date} className="ml-auto font-mono text-[12px] text-muted">
          {formatShortDate(memory.date)}
        </time>
      </div>
      {!compact && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {memory.tags.map((id) => (
            <Badge key={id}>{TAGS.find((t) => t.id === id)?.label ?? id}</Badge>
          ))}
        </div>
      )}
    </Card>
  )
}
