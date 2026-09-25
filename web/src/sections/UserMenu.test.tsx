/** The account menu (DECISIONS #106): who you are, Company Settings for admin and owner, Log Out. Calendar, Search, Company Files
 * and Only me are in the header, and the Tags page is gone. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const auth = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => auth.value }))
vi.mock('../features/auth/CompanySwitcher', () => ({ CompanySwitcher: () => null }))

import { UserMenu } from './UserMenu'

const as = (role: string) => ({ user: { email: 'pat@acme.test' }, company: { name: 'Acme Pte Ltd' }, role, logout: vi.fn().mockResolvedValue(undefined) })
const openMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Account menu' }))
  return screen.getByRole('menu')
}

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

describe('UserMenu', () => {
  it.each(['owner', 'admin'])('a %s: the who-you-are block, Company Settings and Log Out', (role) => {
    auth.value = as(role)
    render(<UserMenu />)
    const menu = openMenu()
    expect(within(menu).getByText('Acme Pte Ltd')).toBeTruthy()
    expect(within(menu).getByText('pat@acme.test')).toBeTruthy()
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent).filter((t) => t === 'Company Settings' || t === 'Log Out')).toEqual(['Company Settings', 'Log Out'])
    expect(within(menu).getByRole('menuitem', { name: 'Company Settings' }).getAttribute('href')).toBe('/company-settings')
  })

  it.each(['user', 'viewer'])('a %s: no Company Settings, and Log Out', (role) => {
    auth.value = as(role)
    render(<UserMenu />)
    const menu = openMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Company Settings' })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: 'Log Out' })).toBeTruthy()
  })

  it('has no Tags, and lists Search and Only me ONLY for the widths where the header has no room for them (sm to lg)', () => {
    auth.value = as('owner')
    render(<UserMenu />)
    const menu = openMenu()
    expect(within(menu).queryByRole('menuitem', { name: 'Tags' })).toBeNull()
    const narrow = within(menu).getByTestId('menu-narrow-routes')
    expect(within(narrow).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Search', 'Only me'])
    // hidden on a phone (the bottom bar has them) and from lg (the header has them)
    expect(narrow.className).toContain('hidden')
    expect(narrow.className).toContain('sm:block')
    expect(narrow.className).toContain('lg:hidden')
  })

  it('a viewer\'s narrow-width list is Search only: no Only me for a viewer', () => {
    auth.value = as('viewer')
    render(<UserMenu />)
    const menu = openMenu()
    expect(within(within(menu).getByTestId('menu-narrow-routes')).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Search'])
  })

  it('renders nothing without a user', () => {
    auth.value = { user: null, company: null, role: null, logout: vi.fn() }
    const { container } = render(<UserMenu />)
    expect(container.firstChild).toBeNull()
  })
})
