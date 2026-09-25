/** The upload limits and how much of the private-file allowance this person has used, for the Only me page
 * (2026-09-25, round 20, item 6, DECISIONS #99): one fetch of GET /api/limits, and a refresh the upload flow and
 * Delete call, so "you have 12 of 15" is never stale after either. `limits` is null until it is known, and
 * stays null against a backend that has no such endpoint: the page then says nothing about limits rather than
 * something it cannot back up. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { opsApi, type Limits } from '../ops/opsApi'

export function usePersonalLimits(enabled: boolean) {
  const [limits, setLimits] = useState<Limits | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const next = await opsApi.getLimits()
      if (mounted.current) setLimits(next)
    } catch {
      // Keep the last known numbers; a failed refresh is not a reason to hide them.
    }
  }, [])

  useEffect(() => {
    if (enabled) void refresh()
  }, [enabled, refresh])

  return { limits, refresh }
}
