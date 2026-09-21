import { useCallback, useRef, useState } from 'react'
import { mockSearchService, type SearchResult, type SearchService } from './searchService'

export type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'done'; result: SearchResult }
  | { status: 'error'; message: string }

/** Owns the search request lifecycle. Presentational components only read `state`. */
export function useMemorySearch(service: SearchService = mockSearchService) {
  const [state, setState] = useState<SearchState>({ status: 'idle' })
  const latest = useRef(0)

  const run = useCallback(
    async (query: string) => {
      const trimmed = query.trim()
      if (!trimmed) {
        setState({ status: 'idle' })
        return
      }
      const ticket = ++latest.current
      setState({ status: 'loading', query: trimmed })
      try {
        const result = await service.search(trimmed)
        if (ticket === latest.current) setState({ status: 'done', result })
      } catch {
        if (ticket === latest.current) setState({ status: 'error', message: 'Search is unavailable right now. Please try again.' })
      }
    },
    [service],
  )

  const clear = useCallback(() => {
    latest.current++
    setState({ status: 'idle' })
  }, [])

  return { state, run, clear }
}
