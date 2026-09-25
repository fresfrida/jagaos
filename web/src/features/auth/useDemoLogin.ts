/** Signs the visitor in as one of the seeded demo accounts through the ordinary login
 * flow (2026-09-24, round 16, DECISIONS #90; a chosen account since round 20): the same
 * `login()` the /login form calls, with the chosen demo email filled in for them, then the
 * same landing page the form goes to: the signed-in home (`/`), which is the hub for a person who can
 * upload and the Only me page for a viewer (round 20, item 2). Nothing here skips authentication; a backend
 * without the account answers with an error like any unknown email, which is surfaced. */

import { useCallback, useState } from 'react'
import { navigate } from '../../router/navigate'
import { routeHref } from '../../router/routes'
import { useAuth } from './AuthContext'

export function useDemoLogin() {
  const { login } = useAuth()
  // The email being signed in, so the picker can show which row is working.
  const [signingInAs, setSigningInAs] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const start = useCallback(
    async (email: string) => {
      setSigningInAs(email)
      setFailed(false)
      try {
        await login({ email })
        navigate(routeHref('home'))
      } catch {
        setFailed(true)
        setSigningInAs(null) // on success the page changes, so there is nothing to un-busy
      }
    },
    [login],
  )

  const clearFailure = useCallback(() => setFailed(false), [])

  return { busy: signingInAs !== null, signingInAs, failed, clearFailure, start }
}
