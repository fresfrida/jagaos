/** The one fetch wrapper for the real backend (app/main.py) — authApi.ts
 * and features/ops/opsApi.ts both call this rather than each keeping its
 * own copy. Extracts FastAPI's {"detail": "..."} error body into a plain
 * message instead of surfacing raw JSON in the UI. */

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, init)
  if (!res.ok) {
    const bodyText = await res.text()
    let message = bodyText
    try {
      const parsed = JSON.parse(bodyText) as { detail?: unknown }
      if (typeof parsed.detail === 'string') message = parsed.detail
    } catch {
      // Not JSON (or no `detail` field) — fall back to the raw body text.
    }
    throw new Error(message || `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}
