/** The caller's own personal files, for the Only me section (2026-09-25, round 19,
 * DECISIONS #94): one fetch of GET /api/personal-files with visible loading and error
 * states, and a refresh the upload flow and the document cards call. All side effects
 * live here so the page composes. Nothing about company documents passes through it. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { opsApi, type DocumentRow } from '../ops/opsApi'

export type PersonalFilesState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; files: DocumentRow[] }

export function usePersonalFiles(enabled: boolean) {
  const [state, setState] = useState<PersonalFilesState>({ status: 'loading' })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const files = await opsApi.listPersonalFiles()
      if (mounted.current) setState({ status: 'ready', files })
    } catch (e) {
      // A refresh after a good load keeps showing the last good list rather than blanking it.
      if (mounted.current) setState((previous) => (previous.status === 'ready' ? previous : { status: 'failed', message: e instanceof Error ? e.message : String(e) }))
    }
  }, [])

  useEffect(() => {
    if (enabled) void refresh()
  }, [enabled, refresh])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    void refresh()
  }, [refresh])

  return { state, refresh, retry }
}
