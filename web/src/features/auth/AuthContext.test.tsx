/** 2026-09-27 bug: an expired token showed the backend's raw "Missing or malformed Authorization header" instead of returning to
 * the login picker, and Log Out itself could 401 (its own token already invalid) and silently do nothing. Two independent fixes:
 * ANY 401, anywhere, resets the session (apiClient's onUnauthorized hook, wired here); logout() resets local state in a finally,
 * so a failing POST /api/auth/logout still signs the app out. */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status, statusText: 'x' }))

import { ApiError } from '../../lib/apiClient'
import { authApi, clearToken } from './authApi'
import { AuthProvider, useAuth } from './AuthContext'

function Probe() {
  const auth = useAuth()
  return (
    <div>
      <p data-testid="status">{auth.status}</p>
      <button onClick={() => void auth.logout()}>log out</button>
    </div>
  )
}

beforeEach(() => localStorage.setItem('jagaos_session_token', 'a-token'))
afterEach(() => {
  cleanup()
  clearToken()
  vi.restoreAllMocks()
})

describe('AuthContext', () => {
  it('a 401 from any call resets the session to signed-out and clears the stored token', async () => {
    respond(200, { user: { id: 1, email: 'a@b.test', name: null }, company: { id: 1, name: 'Co', fye_month: 12, fye_day: 31, timezone: 'Asia/Singapore' }, role: 'owner' })
    render(<AuthProvider><Probe /></AuthProvider>)
    await screen.findByText('signed-in')

    respond(401, { detail: 'Session expired. Log in again.' })
    await act(async () => {
      await authApi.me().catch(() => {}) // any endpoint, not just logout — the handler is global
    })
    expect(screen.getByTestId('status').textContent).toBe('signed-out')
    expect(localStorage.getItem('jagaos_session_token')).toBeNull()
  })

  it('Log Out resets local state even when the API call itself fails (its own token already invalid)', async () => {
    respond(200, { user: { id: 1, email: 'a@b.test', name: null }, company: { id: 1, name: 'Co', fye_month: 12, fye_day: 31, timezone: 'Asia/Singapore' }, role: 'owner' })
    render(<AuthProvider><Probe /></AuthProvider>)
    await screen.findByText('signed-in')

    respond(401, { detail: 'Missing or malformed Authorization header' })
    await act(async () => {
      screen.getByText('log out').click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByTestId('status').textContent).toBe('signed-out')
    expect(localStorage.getItem('jagaos_session_token')).toBeNull()
  })

  it('a non-401 error never triggers the reset (a 500 from one page stays that page’s own error)', async () => {
    respond(200, { user: { id: 1, email: 'a@b.test', name: null }, company: { id: 1, name: 'Co', fye_month: 12, fye_day: 31, timezone: 'Asia/Singapore' }, role: 'owner' })
    render(<AuthProvider><Probe /></AuthProvider>)
    await screen.findByText('signed-in')

    respond(500, { detail: 'boom' })
    await act(async () => {
      const error = await authApi.me().catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ApiError)
    })
    expect(screen.getByTestId('status').textContent).toBe('signed-in')
  })
})
