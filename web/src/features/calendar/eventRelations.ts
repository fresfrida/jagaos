import { MEMORIES } from '../memories/mockData'
import { memoriesByIds, memoryHasTag } from '../memories/memoryMatching'
import type { Memory, SourceRef } from '../memories/types'
import type { CalendarEvent } from './types'

export interface EventRelations {
  /** Unique source references across the event's related memories. */
  documents: SourceRef[]
  /** Related memories tagged "decisions". */
  decisions: Memory[]
}

/** Detail-panel rule: documents = distinct sources of related memories; decisions = related memories tagged Decisions. */
export function getEventRelations(event: CalendarEvent): EventRelations {
  const related = memoriesByIds(MEMORIES, event.relatedMemoryIds)
  const seen = new Set<string>()
  const documents = related
    .flatMap((m) => m.sources)
    .filter((s) => {
      const key = `${s.kind}:${s.label}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  return { documents, decisions: related.filter((m) => memoryHasTag(m, 'decisions')) }
}
