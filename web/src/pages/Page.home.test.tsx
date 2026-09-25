/** What renders at "/" (round 20, item 2): one route, conditional on the session and the role, and
 * never a redirect. */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const auth = vi.hoisted(() => ({ value: { status: 'signed-out', role: null } as { status: string; role: string | null } }))
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => auth.value }))
vi.mock('../router/navigate', () => ({ navigate: vi.fn() }))
vi.mock('../sections/WelcomeHero', () => ({ WelcomeHero: () => <div data-testid="landing" /> }))
vi.mock('./SignedInHome', () => ({ SignedInHome: () => <div data-testid="hub" /> }))
vi.mock('./OnlyMePage', () => ({ OnlyMePage: () => <div data-testid="only-me-page" /> }))

import { navigate } from '../router/navigate'
import { Page } from './Page'

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(navigate).mockReset()
  auth.value = { status: 'signed-out', role: null }
})
afterEach(cleanup)

const renderHome = () => render(<Page route="home" />)

describe('the home route', () => {
  it('signed out is the landing page', () => {
    renderHome()
    expect(screen.getByTestId('landing')).toBeTruthy()
  })

  it.each(['owner', 'admin', 'user'])('a %s gets the hub', (role) => {
    auth.value = { status: 'signed-in', role }
    renderHome()
    expect(screen.getByTestId('hub')).toBeTruthy()
    expect(screen.queryByTestId('landing')).toBeNull()
  })

  it('a viewer gets the Only me page at "/", inside its own page frame', () => {
    auth.value = { status: 'signed-in', role: 'viewer' }
    renderHome()
    expect(screen.getByTestId('only-me-page')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Only me')
    expect(screen.queryByTestId('hub')).toBeNull()
  })

  it('nobody is redirected: a signed-in visitor never bounces to the Calendar', () => {
    for (const role of ['owner', 'user', 'viewer']) {
      auth.value = { status: 'signed-in', role }
      renderHome()
      cleanup()
    }
    expect(navigate).not.toHaveBeenCalled()
  })

  it('a signed-in visitor never sees the landing page, so no sign-in call to action is left to swap', () => {
    for (const role of ['owner', 'admin', 'user', 'viewer']) {
      auth.value = { status: 'signed-in', role }
      renderHome()
      expect(screen.queryByTestId('landing')).toBeNull()
      cleanup()
    }
  })
})
