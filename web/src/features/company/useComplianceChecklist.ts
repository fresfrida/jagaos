/** What the compliance checklist needs (round 21, A2, DECISIONS #101): the company's expectations, and the documents
 * list so a satisfied row can link to its evidence. Two reads, in parallel, with visible loading and failed states;
 * nothing else about the company's documents passes through it. Company Settings is where the checklist lives now, and
 * it does not otherwise fetch either, so this is a scoped fetch, not the Calendar's whole useOpsData. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { opsApi, type DocumentRow, type Expectation } from '../ops/opsApi'

export type ChecklistState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; expectations: Expectation[]; documents: DocumentRow[] }

export function useComplianceChecklist(enabled: boolean) {
  const [state, setState] = useState<ChecklistState>({ status: 'loading' })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const [expectations, documents] = await Promise.all([opsApi.listExpectations(), opsApi.listDocuments()])
      if (mounted.current) setState({ status: 'ready', expectations, documents })
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
