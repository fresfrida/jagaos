/** How App wires the footer and the demo picker (DECISIONS #106): the footer is on EVERY page, signed in or out; the one demo
 * picker exists only while nobody is signed in; the bottom bar only while somebody is. */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from './i18n'

const auth = vi.hoisted(() => ({ value: { status: 'signed-out', company: null, login: vi.fn() } as Record<string, unknown> }))
vi.mock('./features/auth/AuthContext', () => ({ AuthProvider: ({ children }: { children: unknown }) => <>{children}</>, useAuth: () => auth.value }))
vi.mock('./features/auth/MyCompaniesContext', () => ({ MyCompaniesProvider: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('./features/auth/useCompanyScopeKey', () => ({ useCompanyScopeKey: () => 'scope' }))
vi.mock('./features/upload/UploadSheetHost', () => ({ UploadSheetHost: () => null }))
vi.mock('./router/useRoute', () => ({ useRoute: () => 'home' }))
vi.mock('./router/useRouteEffects', () => ({ useRouteEffects: () => undefined }))
vi.mock('./pages/Page', () => ({ Page: () => <p>the page</p> }))
vi.mock('./sections/Header', () => ({ Header: () => <header>header</header> }))
vi.mock('./sections/BottomNav', async (importActual) => ({
  ...(await importActual<typeof import('./sections/BottomNav')>()),
  BottomNav: () => <nav aria-label="bottom bar" />,
}))

import { openDemoPicker } from './lib/demoPickerTrigger'
import App from './App'

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

describe('App, signed out', () => {
  beforeEach(() => { auth.value = { status: 'signed-out', company: null, login: vi.fn() } })

  it('has the footer, with Get Started, and no bottom bar', () => {
    render(<App />)
    expect(screen.getByRole('contentinfo').textContent).toContain('© 2026 Platform R PCIB Pte Ltd')
    expect(screen.getByRole('button', { name: 'Get Started' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'bottom bar' })).toBeNull()
  })

  it('any Get Started signal opens the one picker', () => {
    render(<App />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => openDemoPicker())
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
})

describe('App, signed in', () => {
  beforeEach(() => { auth.value = { status: 'signed-in', company: { id: 1 }, login: vi.fn() } })

  it('has the footer too, without Get Started, and the bottom bar', () => {
    render(<App />)
    expect(screen.getByRole('contentinfo').textContent).toContain('© 2026 Platform R PCIB Pte Ltd')
    expect(screen.queryByRole('button', { name: 'Get Started' })).toBeNull()
    expect(screen.getByRole('navigation', { name: 'bottom bar' })).toBeTruthy()
  })

  it('has no picker: a signal opens nothing', () => {
    render(<App />)
    act(() => openDemoPicker())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the footer follows the page inside the document, and <main> no longer carries the bottom-bar padding', () => {
    const { container } = render(<App />)
    const main = container.querySelector('main')!
    expect(main.className).not.toContain('pb-[calc')
    expect(main.nextElementSibling!.tagName).toBe('FOOTER')
  })
})
