/** The company's pending purge requests, for the owner's Company Settings (round 21, A5, DECISIONS #101): one read of
 * GET /api/purge-requests (owner only) with visible loading and failed states. Read-only: a request is cleared by the team
 * purging the document (scripts/purge_document.py), not from here. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { opsApi, type PurgeRequest } from '../ops/opsApi'

export type PurgeRequestsState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; requests: PurgeRequest[] }

export function usePurgeRequests(enabled: boolean) {
  const [state, setState] = useState<PurgeRequestsState>({ status: 'loading' })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const requests = await opsApi.listPurgeRequests()
      if (mounted.current) setState({ status: 'ready', requests })
    } catch (e) {
      if (mounted.current) setState({ status: 'failed', message: e instanceof Error ? e.message : String(e) })
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
