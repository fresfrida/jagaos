import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { setUnauthorizedHandler } from '../../lib/apiClient'
import { authApi, clearToken, getToken, type Company, type DevLoginParams, type Role, type User } from './authApi'

interface AuthState {
  status: 'loading' | 'signed-out' | 'signed-in'
  user: User | null
  company: Company | null
  role: Role | null
  error: string | null
}

interface AuthContextValue extends AuthState {
  login: (params: DevLoginParams) => Promise<void>
  logout: () => Promise<void>
  // 2026-09-23 (role/permission work): the company-settings page needs the
  // rest of the app (header, any other open tab reading company.name) to
  // reflect a save immediately, not just on the next full reload — a
  // targeted re-fetch of /api/auth/me rather than a second, parallel
  // "update company in place" code path.
  refreshCompany: () => Promise<void>
  // 2026-09-24 (round 12, DECISIONS #77): scope this session to another
  // company the user belongs to. Replaces `company` and `role` wholesale from
  // the server's answer — the singular `company` field stays singular, there
  // is no companies[] here (the switcher's own list lives in
  // useMyCompanies). App.tsx keys the routed page on company.id, so every
  // page remounts and refetches for the new company.
  switchCompany: (companyId: number) => Promise<void>
  // Re-reads /api/auth/me and applies it ONLY if the active company or role
  // actually changed. The session's active company is server-side, so a
  // switch made in another tab of this browser changes what THIS tab's next
  // request is scoped to while this tab's header still names the old one;
  // the switcher calls this on tab focus to close that gap. Deliberately not
  // refreshCompany: replacing `company` with an equal-but-new object would
  // reset any form that resyncs from it (Company Settings) mid-edit.
  syncActiveCompany: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Session state for the whole logged-in app — one fetch of /api/auth/me
 * on mount if a token is already stored, otherwise signed-out. Every
 * authenticated page reads this instead of managing its own session
 * check, so "who am I" has one answer app-wide. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading', user: null, company: null, role: null, error: null,
  })

  // Any call anywhere in the app coming back 401 (a token gone missing, expired or revoked mid-session, apiClient.ts) means the
  // same thing everywhere: drop the stale token and fall back to the login picker, rather than a page showing the backend's raw
  // "Missing or malformed Authorization header" as if it were its own error. One handler, registered once, for every call site.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearToken()
      setState({ status: 'signed-out', user: null, company: null, role: null, error: null })
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  useEffect(() => {
    if (!getToken()) {
      setState({ status: 'signed-out', user: null, company: null, role: null, error: null })
      return
    }
    authApi
      .me()
      .then(({ user, company, role }) => setState({ status: 'signed-in', user, company, role, error: null }))
      .catch(() => {
        clearToken()
        setState({ status: 'signed-out', user: null, company: null, role: null, error: null })
      })
  }, [])

  const login = useCallback(async (params: DevLoginParams) => {
    setState((prev) => ({ ...prev, error: null }))
    try {
      const session = await authApi.devLogin(params)
      setState({
        status: 'signed-in', user: session.user, company: session.company,
        role: session.role, error: null,
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setState((prev) => ({ ...prev, error: message }))
      throw e
    }
  }, [])

  const logout = useCallback(async () => {
    // authApi.logout() already clears the stored token even if the POST fails (its own token already invalid, a 401,
    // is exactly the case this is for). Local state must reset the same way — and the call NEVER rethrows: the one
    // caller (UserMenu) does `logout().then(() => navigate(...))` with no .catch, so a rethrow here would silently
    // cancel the "go to the login picker" step too, leaving Log Out looking like it did nothing.
    try {
      await authApi.logout()
    } catch {
      // signing out locally does not depend on the server call having succeeded
    } finally {
      setState({ status: 'signed-out', user: null, company: null, role: null, error: null })
    }
  }, [])

  const refreshCompany = useCallback(async () => {
    const { company, role } = await authApi.me()
    setState((prev) => ({ ...prev, company, role }))
  }, [])

  const switchCompany = useCallback(async (companyId: number) => {
    const { company, role } = await authApi.switchCompany(companyId)
    setState((prev) => ({ ...prev, company, role }))
  }, [])

  const syncActiveCompany = useCallback(async () => {
    const { company, role } = await authApi.me()
    setState((prev) =>
      prev.company?.id === company.id && prev.role === role ? prev : { ...prev, company, role },
    )
  }, [])

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshCompany, switchCompany, syncActiveCompany }}>
      {children}
    </AuthContext.Provider>
  )
}

/** The session if there is a provider, `null` if not: for a small presentational piece that only wants the company's timezone and is
 * rendered on its own in tests, where `useAuth` would throw. */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext)
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
