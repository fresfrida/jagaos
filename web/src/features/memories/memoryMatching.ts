import type { Memory, TagId } from './types'
import { TAGS } from './mockData'

/**
 * Every place that decides "does this memory belong here?" goes through this file:
 * the tag list, the hero search, and the calendar event detail panel.
 * Change a rule here and all three views follow.
 */

export interface MemoryFilter {
  tag?: TagId | null
  query?: string
}

const STOPWORDS = new Set(['the', 'and', 'for', 'was', 'what', 'who', 'when', 'did', 'does', 'with', 'from', 'that', 'this', 'have', 'our', 'about'])

const tagLabel = (id: TagId) => TAGS.find((t) => t.id === id)?.label ?? id

/** Lowercase words of 3+ letters, minus stopwords. */
export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9$.-]+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
}

function haystack(memory: Memory): string {
  const parts = [memory.text, ...memory.tags.map(tagLabel), ...memory.sources.map((s) => s.label)]
  return parts.join(' ').toLowerCase()
}

/** Number of query tokens found in the memory's text, tags or source labels. */
export function scoreMemory(memory: Memory, query: string): number {
  const text = haystack(memory)
  return tokenize(query).filter((token) => text.includes(token)).length
}

export function memoryHasTag(memory: Memory, tag: TagId): boolean {
  return memory.tags.includes(tag)
}

/** Tag AND query filter, newest first. An empty query matches everything. */
export function filterMemories(memories: Memory[], { tag, query = '' }: MemoryFilter): Memory[] {
  const hasQuery = tokenize(query).length > 0
  return memories
    .filter((m) => (tag ? memoryHasTag(m, tag) : true))
    .filter((m) => (hasQuery ? scoreMemory(m, query) > 0 : true))
    .sort((a, b) => b.date.localeCompare(a.date))
}

export function countByTag(memories: Memory[], tag: TagId): number {
  return memories.filter((m) => memoryHasTag(m, tag)).length
}

export function memoriesByIds(memories: Memory[], ids: string[]): Memory[] {
  return ids.map((id) => memories.find((m) => m.id === id)).filter((m): m is Memory => m !== undefined)
}
