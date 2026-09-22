/** Session storage + the auth HTTP calls. The one place a token is read,
 * written or attached to a request — features/ops's api client imports
 * `authHeaders`/`getToken` from here rather than re-implementing it. */

import { apiRequest } from '../../lib/apiClient'

const TOKEN_KEY = 'jagaos_session_token'

export type Role = 'owner' | 'admin' | 'user' | 'viewer'

export interface User {
  id: number
  email: string
  name: string | null
}

export interface Company {
  id: number
  name: string
}

export interface Session {
  token: string
  user: User
  company: Company
  role: Role
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // private-browsing / storage blocked — session just won't survive a reload
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // nothing to clean up if storage was never reachable
  }
}

export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export interface DevLoginParams {
  email: string
  name?: string
  /** Give to create a new company (caller becomes its owner); omit to log
   * into an existing membership. */
  company_name?: string
  fye_month?: number
  fye_day?: number
}

export const authApi = {
  /** Placeholder for real magic-link email — see app/auth.py's docstring.
   * Same session/role model either way; only the delivery step is a stand-in. */
  devLogin: async (params: DevLoginParams): Promise<Session> => {
    const session = await apiRequest<Session>('/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    setToken(session.token)
    return session
  },

  me: () =>
    apiRequest<{ user: User; company: Company; role: Role }>('/api/auth/me', {
      headers: authHeaders(),
    }),

  logout: async (): Promise<void> => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST', headers: authHeaders() })
    } finally {
      clearToken()
    }
  },
}

export const ROLE_ORDER: Record<Role, number> = { viewer: 0, user: 1, admin: 2, owner: 3 }

/** Mirrors app/auth.py's ROLE_ORDER — the frontend never re-derives what a
 * role can do beyond hiding/disabling actions the backend would reject
 * anyway; this is for UI affordances, not a second source of truth. */
export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_ORDER[role] >= ROLE_ORDER[min]
}
