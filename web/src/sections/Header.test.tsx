/** The signed-out header on a phone (round 20, item 8): only the logo, the language select
 * and Log In. The inline Calendar and Tags links (and Get Started) are for `sm` and up. */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const auth = vi.hoisted(() => ({ value: { status: 'signed-out', user: null, role: null } as Record<string, unknown> }))
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => auth.value }))
vi.mock('../hooks/useScrolled', () => ({ useScrolled: () => false }))

import { Header } from './Header'

beforeEach(async () => {
  await i18n.changeLanguage('en')
  auth.value = { status: 'signed-out', user: null, role: null }
})
afterEach(cleanup)

describe('Header, signed out', () => {
  it('hides the inline Calendar and Tags nav below sm, so a phone row is logo, language and Log In', () => {
    render(<Header current="home" />)
    const nav = screen.getByRole('navigation')
    expect(nav.className).toContain('hidden')
    expect(nav.className).toContain('sm:block')
    expect(nav.textContent).toContain('Calendar')
    expect(nav.textContent).toContain('Tags')
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Log In' }).getAttribute('href')).toBe('/login')
  })

  it('keeps Get Started for sm and up only', () => {
    render(<Header current="home" />)
    const getStarted = screen.getByRole('link', { name: 'Get Started' })
    expect(getStarted.parentElement!.className).toContain('hidden')
    expect(getStarted.parentElement!.className).toContain('sm:block')
  })
})
