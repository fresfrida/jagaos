import { MEMORIES } from '../memories/mockData'
import { filterMemories, scoreMemory } from '../memories/memoryMatching'
import type { Memory } from '../memories/types'

export interface SearchResult {
  query: string
  /** Best matches first, capped. */
  matches: Memory[]
}

/** Boundary for the future API. The mock below is replaced by a fetch to the Lightsail backend. */
export interface SearchService {
  search(query: string): Promise<SearchResult>
}

const MAX_MATCHES = 3
const MOCK_LATENCY_MS = 450

export const mockSearchService: SearchService = {
  async search(query) {
    await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS))
    const matches = filterMemories(MEMORIES, { query })
      .sort((a, b) => scoreMemory(b, query) - scoreMemory(a, query))
      .slice(0, MAX_MATCHES)
    return { query, matches }
  },
}
