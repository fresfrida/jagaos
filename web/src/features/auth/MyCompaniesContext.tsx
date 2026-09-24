/** The companies the signed-in user belongs to, for the switcher (2026-09-24,
 * round 12, DECISIONS #77). A context of its own rather than a companies[] on
 * AuthContext: that keeps its singular `company` (DECISIONS #71), and only the
 * switcher needs the list. One provider means ONE fetch per sign-in and ONE
 * tab-focus listener — the switcher is rendered in two places (the desktop
 * header and the phone's account menu) and both read from here.
 *
 * Fails quiet: on any error (a backend older than this endpoint, a network
 * blip) the list is [] — which hides the switcher, i.e. the app behaves
 * exactly as it did before switching existed.
 *
 * Tab-focus re-sync: the session's active company lives on the server, so a
 * switch made in another tab of this browser changes what THIS tab's next
 * request is scoped to while its header still names the old company (a
 * document uploaded from the stale tab would land in the other company).
 * Whenever this tab is looked at again, and only for someone who can switch,
 * AuthContext.syncActiveCompany re-reads /me and applies it only if the
 * active company or role actually changed. */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { authApi, type MyCompany } from './authApi'
import { useAuth } from './AuthContext'
import { hasSwitchableCompanies } from './companySwitcherModel'

const MyCompaniesContext = createContext<MyCompany[]>([])

export function MyCompaniesProvider({ children }: { children: ReactNode }) {
  const { status, user, syncActiveCompany } = useAuth()
  const [companies, setCompanies] = useState<MyCompany[]>([])
  const userId = user?.id ?? null

  useEffect(() => {
    if (status !== 'signed-in' || userId === null) {
      setCompanies([])
      return
    }
    let cancelled = false
    authApi
      .listCompanies()
      .then((rows) => {
        if (!cancelled) setCompanies(rows)
      })
      .catch(() => {
        if (!cancelled) setCompanies([])
      })
    return () => {
      cancelled = true
    }
  }, [status, userId])

  const switchable = hasSwitchableCompanies(companies)
  useEffect(() => {
    if (!switchable) return
    const resync = () => {
      if (document.visibilityState === 'visible') void syncActiveCompany().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', resync)
    window.addEventListener('focus', resync)
    return () => {
      document.removeEventListener('visibilitychange', resync)
      window.removeEventListener('focus', resync)
    }
  }, [switchable, syncActiveCompany])

  return <MyCompaniesContext.Provider value={companies}>{children}</MyCompaniesContext.Provider>
}

export function useMyCompanies(): MyCompany[] {
  return useContext(MyCompaniesContext)
}
