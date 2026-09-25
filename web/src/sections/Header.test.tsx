/** The header (DECISIONS #106). Signed out: the logo, the language select and, from `sm` up, ONE Get Started button that opens the
 * demo picker; no Log In, no Calendar / Tags tabs. Signed in: Calendar, Search, Company Files (and Only me from user up) in the
 * header itself, and Upload as the one solid button unless the person is a viewer. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const auth = vi.hoisted(() => ({ value: { status: 'signed-out', user: null, role: null } as Record<string, unknown> }))
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => auth.value }))
vi.mock('../hooks/useScrolled', () => ({ useScrolled: () => false }))
vi.mock('../features/auth/CompanySwitcher', () => ({ CompanySwitcher: ({ className }: { className?: string }) => <div data-testid="switcher" className={className} /> }))
vi.mock('../lib/demoPickerTrigger', () => ({ openDemoPicker: vi.fn() }))

import { openDemoPicker } from '../lib/demoPickerTrigger'
import { Header } from './Header'

const signedIn = (role: string) => ({ status: 'signed-in', user: { email: 'x@y.test' }, company: { name: 'Acme' }, role, logout: vi.fn() })

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(openDemoPicker).mockReset()
  auth.value = { status: 'signed-out', user: null, role: null }
})
afterEach(cleanup)

describe('Header, signed out', () => {
  it('has no Log In and no Calendar or Tags tabs: only the logo, the language select and Get Started', () => {
    render(<Header current="home" />)
    expect(screen.queryByRole('link', { name: 'Log In' })).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull() // no nav landmark at all
    expect(screen.queryByRole('link', { name: 'Calendar' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Tags' })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Language' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'JagaOS home' })).toBeTruthy()
  })

  it('Get Started is a button that opens the demo picker, not a link to /calendar', () => {
    render(<Header current="home" />)
    expect(screen.queryByRole('link', { name: 'Get Started' })).toBeNull()
    const button = screen.getByRole('button', { name: 'Get Started' })
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')
    fireEvent.click(button)
    expect(openDemoPicker).toHaveBeenCalledTimes(1)
  })

  it('keeps Get Started for sm and up only, so a phone row stays the logo and the language select', () => {
    render(<Header current="home" />)
    const wrapper = screen.getByRole('button', { name: 'Get Started' }).parentElement!
    expect(wrapper.className).toContain('hidden')
    expect(wrapper.className).toContain('sm:block')
  })
})

describe('Header, signed in: the exact list per role', () => {
  const navLabels = () => within(screen.getByRole('navigation')).getAllByRole('link').map((a) => a.textContent)

  it.each(['owner', 'admin', 'user'])('a %s: Calendar, Search, Company Files, Only me, and an Upload button', (role) => {
    auth.value = signedIn(role)
    render(<Header current="calendar" />)
    expect(navLabels()).toEqual(['Calendar', 'Search', 'Company Files', 'Only me'])
    expect(screen.getByRole('link', { name: 'Upload' }).getAttribute('href')).toBe('/upload')
    expect(screen.queryByRole('link', { name: 'Tags' })).toBeNull()
  })

  it('a viewer: Calendar, Search, Company Files, no Only me and no Upload button', () => {
    auth.value = signedIn('viewer')
    render(<Header current="calendar" />)
    expect(navLabels()).toEqual(['Calendar', 'Search', 'Company Files'])
    expect(screen.queryByRole('link', { name: 'Upload' })).toBeNull()
  })

  it('links each item to its page and marks the current one', () => {
    auth.value = signedIn('owner')
    render(<Header current="search" />)
    const hrefs = within(screen.getByRole('navigation')).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/calendar', '/search', '/company-files', '/only-me'])
    expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'Search' }).getAttribute('aria-current')).toBe('page')
    expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'Calendar' }).getAttribute('aria-current')).toBeNull()
  })

  it('the inline nav and the Upload button are for sm and up: a phone has the bottom bar', () => {
    auth.value = signedIn('owner')
    render(<Header current="calendar" />)
    expect(screen.getByRole('navigation').className).toContain('hidden')
    expect(screen.getByRole('navigation').className).toContain('sm:block')
    expect(screen.getByRole('link', { name: 'Upload' }).parentElement!.className).toContain('sm:block')
  })

  it('the inline company switcher is capped wide enough for a whole company name, and only from xl (DECISIONS #109)', () => {
    auth.value = signedIn('owner')
    render(<Header current="calendar" />)
    const cls = screen.getByTestId('switcher').className
    expect(cls).toContain('max-w-[240px]') // it was 170px, which cut "Try Demo Pte Ltd" to "Try De..."
    expect(cls).not.toContain('max-w-[170px]')
    expect(cls).toContain('hidden')
    expect(cls).toContain('xl:block') // below xl the same control is in the account menu
  })

  it('Calendar and Company Files are inline from sm; Search and Only me only from lg, where the header has the room', () => {
    auth.value = signedIn('owner')
    render(<Header current="calendar" />)
    const li = (name: string) => within(screen.getByRole('navigation')).getByRole('link', { name }).parentElement!
    expect(li('Calendar').className).not.toContain('hidden')
    expect(li('Company Files').className).not.toContain('hidden')
    for (const name of ['Search', 'Only me']) {
      expect(li(name).className).toContain('hidden')
      expect(li(name).className).toContain('lg:block')
    }
  })
})
