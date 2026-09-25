/** RequireSession sends a signed-out visitor HOME, not to the bare login form (DECISIONS #106). */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

const auth = vi.hoisted(() => ({ value: { status: 'signed-out' } as { status: string } }))
vi.mock('./AuthContext', () => ({ useAuth: () => auth.value }))
vi.mock('../../router/navigate', () => ({ navigate: vi.fn() }))

import { navigate } from '../../router/navigate'
import { RequireSession } from './RequireSession'

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(navigate).mockReset()
})
afterEach(cleanup)

describe('RequireSession', () => {
  it('signed out: redirects to the home page, shows "Redirecting…" and never the page', async () => {
    auth.value = { status: 'signed-out' }
    render(<RequireSession><p>secret page</p></RequireSession>)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
    expect(navigate).not.toHaveBeenCalledWith('/login')
    expect(screen.getByText('Redirecting…')).toBeTruthy()
    expect(screen.queryByText('secret page')).toBeNull()
  })

  it('loading: a placeholder and no redirect yet', () => {
    auth.value = { status: 'loading' }
    render(<RequireSession><p>secret page</p></RequireSession>)
    expect(screen.getByText('Checking your session…')).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('signed in: the page', () => {
    auth.value = { status: 'signed-in' }
    render(<RequireSession><p>secret page</p></RequireSession>)
    expect(screen.getByText('secret page')).toBeTruthy()
    expect(navigate).not.toHaveBeenCalled()
  })
})
