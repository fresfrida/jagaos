/** Where the login form sends a person (round 20, item 2): the signed-in home, `/`. That is the hub
 * for someone who can upload and the Only me page for a viewer, so nobody is first sent to a page
 * (like /upload for a viewer) that is not theirs. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const auth = vi.hoisted(() => ({ value: { status: 'signed-out', login: vi.fn(), error: null } as { status: string; login: ReturnType<typeof vi.fn>; error: string | null } }))
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => auth.value }))
vi.mock('../router/navigate', () => ({ navigate: vi.fn() }))

import { navigate } from '../router/navigate'
import { LoginPage } from './LoginPage'

beforeEach(async () => {
  await i18n.changeLanguage('en')
  auth.value = { status: 'signed-out', login: vi.fn(), error: null }
  vi.mocked(navigate).mockReset()
})
afterEach(cleanup)

describe('LoginPage', () => {
  it('after a successful sign-in it goes to the signed-in home, not to /upload', async () => {
    auth.value.login.mockResolvedValue(undefined)
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'corpsec_rachel@try-demo.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
    expect(auth.value.login).toHaveBeenCalledWith({ email: 'corpsec_rachel@try-demo.test' })
    expect(navigate).not.toHaveBeenCalledWith('/upload')
  })

  it('does not navigate when the sign-in is refused', async () => {
    auth.value.login.mockRejectedValue(new Error('no'))
    render(<LoginPage />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nobody@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    await waitFor(() => expect(auth.value.login).toHaveBeenCalled())
    expect(navigate).not.toHaveBeenCalled()
  })

  it('someone who is already signed in and opens /login is taken to the signed-in home', () => {
    auth.value = { status: 'signed-in', login: vi.fn(), error: null }
    render(<LoginPage />)
    expect(navigate).toHaveBeenCalledWith('/')
  })
})
