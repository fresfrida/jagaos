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
})
afterEach(cleanup)

describe('WelcomeHero', () => {
  it('names the pain in one line and offers the demo, then three cards', () => {
    render(<WelcomeHero />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Stop hunting for paperwork and missing deadlines.')
    expect(screen.getByRole('button', { name: 'Take a look around' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Capture', 'Review', 'Obligations'])
  })

  it('keeps a plain Sign in link for someone with an account', () => {
    render(<WelcomeHero />)
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/login')
  })

  it('the demo button is the ordinary login with the demo email filled in, then the same landing page as the form', async () => {
    login.mockResolvedValue(undefined)
    render(<WelcomeHero />)

    fireEvent.click(screen.getByRole('button', { name: 'Take a look around' }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/upload'))
    expect(login).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenCalledWith({ email: DEMO_OWNER_EMAIL })
    expect(DEMO_OWNER_EMAIL).toBe('owner@try-demo.test')
  })

  it('never navigates, and says so, when the login is refused (a backend without the demo account)', async () => {
    login.mockRejectedValue(new Error('No company membership yet'))
    render(<WelcomeHero />)

    fireEvent.click(screen.getByRole('button', { name: 'Take a look around' }))

    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't open the demo")
    expect(navigate).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Take a look around' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows progress and blocks a second click while signing in', async () => {
    let finish: () => void = () => undefined
    login.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    render(<WelcomeHero />)

    fireEvent.click(screen.getByRole('button', { name: 'Take a look around' }))

    const busy = await screen.findByRole('button', { name: /opening the demo/i })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    finish()
  })
})
