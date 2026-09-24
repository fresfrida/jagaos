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
  // 2026-09-23 (role/permission work): previously never returned by
  // dev-login/me — nothing read them, since there was no endpoint to edit
  // them either. Both now exist for the company-settings page.
  fye_month: number
  fye_day: number
  // 2026-09-24 (company-local dates): IANA name, e.g. "Asia/Singapore" —
  // Calendar's day-bucketing/"today" highlight needs this instead of the
  // viewing device's own local time (lib/dates.ts's dayInTimezone/
  // todayInTimezone).
  timezone: string
  // 2026-09-24 (round 12, DECISIONS #79): the rest of what Company Settings
  // edits (and an ACRA business profile can pre-fill). Optional on purpose —
  // a backend older than these fields (the Vercel frontend deploys on push,
  // the Lightsail backend only when redeployed) sends none of them; the form
  // then treats them as blank rather than crashing.
  uen?: string | null
  gst_registered?: boolean
  registered_address?: string | null
}

/** One row of GET /api/auth/companies: a company the caller belongs to and
 * the role they hold THERE. group_* are set only on an owner membership
 * (app/auth.py::list_memberships) — a non-owner never learns a group exists. */
export interface MyCompany {
  id: number
  name: string
  role: Role
  group_id: number | null
  group_name: string | null
}

/** Company Settings values read from a confirmed ACRA business profile
 * (GET /api/documents/{id}/company-profile). null = the document did not
 * state it (or it was unusable) — the form leaves that field as it is. */
export interface CompanyProfilePrefill {
  document_id: number
  filename: string
  name: string | null
  uen: string | null
  fye_month: number | null
  fye_day: number | null
  gst_registered: boolean | null
  registered_address: string | null
}

/** GET /api/business-profile (owner only): the company's current business-profile
 * document for the Company Settings section, or null. A business profile is not in
 * the Company Files / Search / Calendar lists (round 16, DECISIONS #90); this is
 * the one place it is fetched. `can_prefill` is true once a person has confirmed
 * its extracted values in the review queue. */
export interface BusinessProfileDocument {
  id: number
  filename: string
  media_type: string
  status: string
  received_at: string
  can_prefill: boolean
}

export interface CompanyUpdate {
  name?: string
  fye_month?: number
  fye_day?: number
  timezone?: string
  uen?: string
  gst_registered?: boolean
  registered_address?: string
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

  // Company settings (2026-09-23, role/permission work) — owner-only
  // server-side (require_role("owner"), app/main.py::edit_company); the
  // frontend gates the page/fields the same way but the backend check is
  // the real one. The body is CompanyEditRequest (app/models.py).
  updateCompany: (companyId: number, body: CompanyUpdate) =>
    apiRequest<{ status: string }>(`/api/companies/${companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    }),

  // Company switcher (2026-09-24, round 12, DECISIONS #77). The list is the
  // caller's OWN memberships and nothing else; the switch is server-side,
  // per session, and answers with the same shape as /me for the company now
  // active — every data endpoint then scopes to it with no company id sent.
  listCompanies: () => apiRequest<MyCompany[]>('/api/auth/companies', { headers: authHeaders() }),

  switchCompany: (companyId: number) =>
    apiRequest<{ user: User; company: Company; role: Role }>('/api/auth/switch-company', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ company_id: companyId }),
    }),

  getBusinessProfile: () =>
    apiRequest<{ document: BusinessProfileDocument | null }>('/api/business-profile', { headers: authHeaders() }),

  // Owner-only, read-only (app/main.py::get_company_profile_prefill) — the
  // values for the settings form; nothing is written until the owner saves.
  getCompanyProfilePrefill: (documentId: number) =>
    apiRequest<CompanyProfilePrefill>(`/api/documents/${documentId}/company-profile`, { headers: authHeaders() }),
}

export const ROLE_ORDER: Record<Role, number> = { viewer: 0, user: 1, admin: 2, owner: 3 }

/** Mirrors app/auth.py's ROLE_ORDER — the frontend never re-derives what a
 * role can do beyond hiding/disabling actions the backend would reject
 * anyway; this is for UI affordances, not a second source of truth. */
export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_ORDER[role] >= ROLE_ORDER[min]
}
