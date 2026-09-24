/** Loads the values of a confirmed business profile for the Company Settings
 * form (2026-09-24, round 12, DECISIONS #79). Read-only: nothing is written until
 * the owner has confirmed the changes (PrefillConfirmSheet) and then saved the form.
 *
 * `documentId` is the current business-profile document, set when the owner asks
 * to fill the form from it. (Until round 16 it came from a `?prefill=` query the
 * Company Files card linked with; that card link and query are gone, DECISIONS #90.) */

import { useEffect, useState } from 'react'
import { authApi, type CompanyProfilePrefill } from '../auth/authApi'

export type PrefillState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; prefill: CompanyProfilePrefill }
  | { status: 'failed' }

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
