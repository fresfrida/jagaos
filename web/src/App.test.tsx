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
const currentRoute = vi.hoisted(() => ({ value: 'home' }))
vi.mock('./router/useRoute', () => ({ useRoute: () => currentRoute.value }))
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

describe('App: the footer and the page height (DECISIONS #108)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    auth.value = { status: 'signed-in', company: { id: 1 }, login: vi.fn() }
  })
  afterEach(() => vi.useRealTimers())

  it('<main> has NO minimum height: a short page is as tall as its content, so its footer sits directly under it', () => {
    const { container } = render(<App />)
    const main = container.querySelector('main')!
    expect(main.className).not.toMatch(/min-h|100svh|100vh/)
  })

  it('the footer stays invisible while the page loads and appears once it has been quiet', () => {
    render(<App />)
    const footer = screen.getByRole('contentinfo', { hidden: true })
    expect(footer.className).toContain('invisible')
    act(() => { vi.advanceTimersByTime(400) })
    expect(footer.className).not.toContain('invisible')
  })
})

describe('App: which pages fill the viewport at desktop width (DECISIONS #109)', () => {
  const shell = (container: HTMLElement) => container.querySelector('main')!.parentElement!

  afterEach(() => { currentRoute.value = 'home' })

  it('the SIGNED-IN home does: a column at least a screen tall, main and its page growing into it, so the footer is at the bottom', () => {
    auth.value = { status: 'signed-in', company: { id: 1 }, login: vi.fn() }
    const { container } = render(<App />)
    expect(shell(container).className).toContain('lg:flex')
    expect(shell(container).className).toContain('lg:min-h-svh')
    expect(shell(container).className).toContain('lg:flex-col')
    expect(container.querySelector('main')!.className).toContain('lg:flex-1')
    expect(container.querySelector('main')!.firstElementChild!.className).toContain('lg:flex-1')
    expect(container.querySelector('main')!.nextElementSibling!.tagName).toBe('FOOTER') // the footer is the shell's last child
  })

  it('no other page does: the general rule holds, main is as tall as its content and the footer sits under it', () => {
    auth.value = { status: 'signed-in', company: { id: 1 }, login: vi.fn() }
    currentRoute.value = 'company-files'
    const { container } = render(<App />)
    expect(shell(container).className).not.toContain('min-h-svh')
    expect(container.querySelector('main')!.className).not.toContain('flex-1')
  })

  it('the signed-out landing does not either', () => {
    auth.value = { status: 'signed-out', company: null, login: vi.fn() }
    const { container } = render(<App />)
    expect(shell(container).className).not.toContain('min-h-svh')
  })
})

