import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const login = vi.fn()
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => ({ login }) }))
vi.mock('../router/navigate', () => ({ navigate: vi.fn() }))

import { DEMO_OWNER_EMAIL } from '../config/demo'
import { navigate } from '../router/navigate'
import { WelcomeHero } from './WelcomeHero'

beforeEach(async () => {
  await i18n.changeLanguage('en')
  login.mockReset()
  vi.mocked(navigate).mockReset()
})
afterEach(cleanup)

describe('WelcomeHero', () => {
  it('names the pain in one line and offers the demo picker, then three cards', () => {
    render(<WelcomeHero />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Stop hunting for paperwork and missing deadlines.')
    expect(screen.getByRole('button', { name: 'Pick a demo role' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Capture', 'Review', 'Obligations'])
  })

  it('has exactly two calls to action, each a button with a line under it: pick a demo role, and sign in for real', () => {
    render(<WelcomeHero />)
    expect(screen.getByRole('button', { name: 'Pick a demo role' })).toBeTruthy()
    expect(screen.getByText('See the app as an owner, admin, user or viewer. No sign-up needed.')).toBeTruthy()
    const signIn = screen.getByRole('link', { name: 'Sign in' })
    expect(signIn.getAttribute('href')).toBe('/login')
    expect(signIn.className).toContain('border-line') // the shared secondary button look: a bordered button, not a quiet text link
    expect(screen.getByText('Use your own email, or set up a new company.')).toBeTruthy()
    expect(screen.queryByText('Already have an account?')).toBeNull()
  })

  it('the demo button opens the picker and signs nobody in by itself', () => {
    render(<WelcomeHero />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Pick a demo role' }))

    expect(screen.getByRole('dialog', { name: 'Try the demo as' })).toBeTruthy()
    expect(login).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('choosing the owner in the picker is the ordinary login with the demo owner email, then the same landing page as the form', async () => {
    login.mockResolvedValue(undefined)
    render(<WelcomeHero />)
    fireEvent.click(screen.getByRole('button', { name: 'Pick a demo role' }))

    fireEvent.click(screen.getByRole('button', { name: /^Owner/ }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
    expect(login).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenCalledWith({ email: DEMO_OWNER_EMAIL })
    expect(DEMO_OWNER_EMAIL).toBe('owner@try-demo.test')
  })
})
