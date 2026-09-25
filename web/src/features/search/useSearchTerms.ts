/** The word cloud's words (round 21, A8, DECISIONS #101): one read of GET /api/search/terms with visible loading and failed
 * states. A backend that predates the endpoint answers 404, which is "no cloud", not an error to show: the Search page then
 * looks exactly as it did. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/apiClient'
import { opsApi, type SearchTerm } from '../ops/opsApi'

export type SearchTermsState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'unavailable' }
  | { status: 'ready'; terms: SearchTerm[] }

export function useSearchTerms(enabled: boolean) {
  const [state, setState] = useState<SearchTermsState>({ status: 'loading' })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const terms = await opsApi.searchTerms()
      if (mounted.current) setState({ status: 'ready', terms })
    } catch (e) {
      if (mounted.current) setState(e instanceof ApiError && e.status === 404 ? { status: 'unavailable' } : { status: 'failed' })
    }
  }, [])

  useEffect(() => {
    if (enabled) void load()
  }, [enabled, load])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    void load()
  }, [load])

  return { state, retry }
}
