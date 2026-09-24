/** Signs the visitor in as the seeded demo owner through the ordinary login flow
 * (2026-09-24, round 16, DECISIONS #90): the same `login()` the /login form calls,
 * with the demo email filled in for them, then the same landing page the form goes
 * to. Nothing here skips authentication; a backend without the demo account
 * answers with an error like any unknown email, which is surfaced. */

import { useCallback, useState } from 'react'
import { DEMO_OWNER_EMAIL } from '../../config/demo'
import { navigate } from '../../router/navigate'
import { routeHref } from '../../router/routes'
import { useAuth } from './AuthContext'

export function useDemoLogin() {
  const { login } = useAuth()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const start = useCallback(async () => {
    setBusy(true)
    setFailed(false)
    try {
      await login({ email: DEMO_OWNER_EMAIL })
      navigate(routeHref('upload'))
    } catch {
      setFailed(true)
      setBusy(false) // on success the page changes, so there is nothing to un-busy
    }
  }, [login])

  return { busy, failed, start }
}
