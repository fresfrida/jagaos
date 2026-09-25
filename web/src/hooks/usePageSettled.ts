import { useEffect, useState } from 'react'
import { usePendingRequests } from '../lib/pendingRequests'

const QUIET_MS = 300
const GIVE_UP_MS = 5000

/** True once the page identified by `pageKey` has finished loading: no API call in flight for a short quiet moment (long enough
 * for the render that follows a response). It goes back to false when `pageKey` changes, so every new page starts unsettled, and
 * it is forced true after a few seconds so a call that never returns cannot keep the footer hidden for good. It does NOT go
 * false again for a request made later on the same page (a save, a search): only a new page hides the footer again. */
export function usePageSettled(pageKey: string): boolean {
  const pending = usePendingRequests()
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    setSettled(false)
    const giveUp = window.setTimeout(() => setSettled(true), GIVE_UP_MS)
    return () => window.clearTimeout(giveUp)
  }, [pageKey])

  useEffect(() => {
    if (pending > 0) return
    const quiet = window.setTimeout(() => setSettled(true), QUIET_MS)
    return () => window.clearTimeout(quiet)
  }, [pending, pageKey])

  return settled
}
