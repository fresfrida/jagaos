/** The one fetch wrapper for the real backend (app/main.py) — authApi.ts
 * and features/ops/opsApi.ts both call this rather than each keeping its
 * own copy. Extracts FastAPI's {"detail": "..."} error body into a plain
 * message instead of surfacing raw JSON in the UI. */

import { trackRequest } from './pendingRequests'

/** Where the browser sends API calls (DECISIONS #119). Three cases, set at BUILD time through `VITE_API_BASE_URL`:
 *   - not set at all: `http://127.0.0.1:8000`, local development against `uvicorn app.main:app`;
 *   - a URL: that API, from wherever the site is served. It is a CROSS-ORIGIN call unless it is the site's own address, so the API
 *     must allow the site in its CORS list (`CORS_ALLOWED_ORIGINS`), and the URL is baked into the build: a build for one hostname
 *     does not work from another (what broke the second hostname of the AWS-served copy);
 *   - set but EMPTY (`VITE_API_BASE_URL=`): the page's OWN origin. Calls are relative (`/api/...`), which is what a copy served by
 *     Caddy next to the API needs, and one build then works from every hostname that reaches that Caddy, with no CORS involved.
 * `??` and not `||`: an empty string is a real choice (the third case), not "missing". */
export const DEFAULT_API_BASE_URL = 'http://127.0.0.1:8000'
export const resolveApiBase = (configured: string | undefined): string => configured ?? DEFAULT_API_BASE_URL
export const API_BASE_URL = resolveApiBase(import.meta.env.VITE_API_BASE_URL)

/** Thrown by apiRequest on a non-2xx response. Carries the HTTP status so
 * callers can branch on it (e.g. a 410 needing a different UI than a
 * generic error) without matching on the message text — that text is for
 * display, not routing, and matching on it would be fragile (2026-09-22:
 * this is exactly what lets ReviewQueueCard detect an expired review
 * session without depending on the backend's exact wording). */
export class ApiError extends Error {
  status: number
  /** A machine-readable reason (round 20): the backend's structured errors, such as `file_too_large`
   * and `personal_file_limit`, send {code, message, ...} as `detail`. The page translates by code. */
  code?: string
  /** The rest of that structured detail (the limit that was hit, for instance). */
  data?: Record<string, unknown>
  constructor(status: number, message: string, code?: string, data?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.data = data
  }
}

/** Every JSON call goes through here, and each one is counted while it is in flight (lib/pendingRequests.ts). */
export function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return trackRequest(send<T>(path, init))
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, init)
  if (!res.ok) {
    const bodyText = await res.text()
    let message = bodyText
    let code: string | undefined
    let data: Record<string, unknown> | undefined
    try {
      const parsed = JSON.parse(bodyText) as { detail?: unknown }
      if (typeof parsed.detail === 'string') {
        message = parsed.detail
      } else if (parsed.detail && typeof parsed.detail === 'object') {
        const detail = parsed.detail as Record<string, unknown>
        if (typeof detail.message === 'string') message = detail.message
        if (typeof detail.code === 'string') code = detail.code
        data = detail
      }
    } catch {
      // Not JSON (or no `detail` field) — fall back to the raw body text.
    }
    throw new ApiError(res.status, message || `${res.status} ${res.statusText}`, code, data)
  }
  return res.json() as Promise<T>
}
