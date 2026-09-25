/** The company's pending purge requests, for the owner's Purge requests page (round 21, A5, DECISIONS #101): one read of
 * GET /api/purge-requests (owner only) with visible loading and failed states. A request is cleared for good by the team purging the
 * document (scripts/purge_document.py); from here the owner can only TAKE ONE BACK (`cancel`, round 3, item 9b, DECISIONS #121), which
 * puts the document back where it was and drops it from this list. */

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

  // Which request is being cancelled, the file name of the last one that was, and why a cancel failed: each visible, none silent.
  const [cancellingId, setCancellingId] = useState<number | null>(null)
  const [cancelledFilename, setCancelledFilename] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const cancel = useCallback(
    async (request: PurgeRequest) => {
      setCancellingId(request.id)
      setCancelError(null)
      setCancelledFilename(null)
      try {
        await opsApi.cancelPurgeRequest(request.id)
        await load() // the row is gone from the server's list now, so the page's list is re-read, not edited by hand
        if (mounted.current) setCancelledFilename(request.filename)
      } catch (e) {
        if (mounted.current) setCancelError(e instanceof Error ? e.message : String(e))
      } finally {
        if (mounted.current) setCancellingId(null)
      }
    },
    [load],
  )

  return { state, retry, cancel, cancellingId, cancelledFilename, cancelError }
}
