/** Loads the values of a confirmed ACRA business profile for the Company
 * Settings form (2026-09-24, round 12, DECISIONS #79). Read-only: nothing is
 * written until the owner saves the form.
 *
 * `documentId` comes from the ?prefill= query param the Company Files card's
 * "Pre-fill company settings" action navigates with. */

import { useEffect, useState } from 'react'
import { authApi, type CompanyProfilePrefill } from '../auth/authApi'

export type PrefillState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; prefill: CompanyProfilePrefill }
  | { status: 'failed' }

export function prefillDocumentIdFromQuery(search: string): number | null {
  const raw = new URLSearchParams(search).get('prefill')
  const id = raw === null ? NaN : Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

export function useCompanyProfilePrefill(documentId: number | null, enabled: boolean): PrefillState {
  const [state, setState] = useState<PrefillState>({ status: 'idle' })

  useEffect(() => {
    if (documentId === null || !enabled) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    authApi
      .getCompanyProfilePrefill(documentId)
      .then((prefill) => {
        if (!cancelled) setState({ status: 'ready', prefill })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'failed' })
      })
    return () => {
      cancelled = true
    }
  }, [documentId, enabled])

  return state
}
