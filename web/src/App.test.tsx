/** How App wires the footer and the demo picker (DECISIONS #106): the footer is on EVERY page, signed in or out; the one demo
 * picker exists only while nobody is signed in; the bottom bar only while somebody is. */

import { act, cleanup, render, screen, within } from '@testing-library/react'
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

  it('has the footer, with its three links and no Get Started button of its own (DECISIONS #111), and no bottom bar', () => {
    render(<App />)
    const footer = screen.getByRole('contentinfo')
    expect(footer.textContent).toContain('© 2026 Platform R PCIB Pte Ltd')
    expect(within(footer).queryByRole('button', { name: 'Get Started' })).toBeNull()
    expect(within(footer).getAllByRole('link').map((a) => a.textContent)).toContain('Watch our intro video')
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

describe('App: which pages fill the viewport at desktop width (DECISIONS #109, #111)', () => {
  const shell = (container: HTMLElement) => container.querySelector('main')!.parentElement!

  afterEach(() => { currentRoute.value = 'home' })

  it('the Header / main / Footer wrapper is the SAME box on every route: a column at least a screen tall (DECISIONS #111)', () => {
    const wrappers = new Set<string>()
    for (const [status, route] of [['signed-in', 'home'], ['signed-in', 'company-files'], ['signed-out', 'home']] as const) {
      auth.value = status === 'signed-in' ? { status, company: { id: 1 }, login: vi.fn() } : { status, company: null, login: vi.fn() }
      currentRoute.value = route
      const { container, unmount } = render(<App />)
      wrappers.add(shell(container).className)
      unmount()
    }
    expect([...wrappers]).toEqual(['flex min-h-svh flex-col']) // one class list for all three: nothing depends on the route
  })

  it('the SIGNED-IN home fills the viewport: main and its page grow into the column, so the footer is at the bottom', () => {
    auth.value = { status: 'signed-in', company: { id: 1 }, login: vi.fn() }
    const { container } = render(<App />)
    expect(container.querySelector('main')!.className).toContain('lg:flex-1')
    expect(container.querySelector('main')!.firstElementChild!.className).toContain('lg:flex-1')
    expect(container.querySelector('main')!.nextElementSibling!.tagName).toBe('FOOTER') // the footer is the shell's last child
  })

  it('no other page does: the general rule holds, main is as tall as its content and the footer sits under it', () => {
    auth.value = { status: 'signed-in', company: { id: 1 }, login: vi.fn() }
    currentRoute.value = 'company-files'
    const { container } = render(<App />)
    expect(container.querySelector('main')!.className).not.toContain('flex-1')
  })

  it('the signed-out landing does not either', () => {
    auth.value = { status: 'signed-out', company: null, login: vi.fn() }
    const { container } = render(<App />)
    expect(container.querySelector('main')!.className).not.toContain('flex-1')
  })
})


describe('App: the footer through navigation (DECISIONS #112)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    auth.value = { status: 'signed-in', company: { id: 1 }, login: vi.fn() }
  })
  afterEach(() => {
    vi.useRealTimers()
    currentRoute.value = 'home'
  })

  it('is revealed by the first page that settles, then STAYS on every later route, and main holds the old height until the new page settles', () => {
    currentRoute.value = 'calendar'
    const { container, rerender } = render(<App />)
    const footer = () => container.querySelector('footer')!
    const main = () => container.querySelector('main') as HTMLElement

    expect(footer().className).toContain('invisible') // the first page is still loading: not seen half-built (DECISIONS #108)
    act(() => { vi.advanceTimersByTime(400) })
    expect(footer().className).not.toContain('invisible')
    expect(main().style.minHeight).toBe('') // nothing is reserved on the first load

    Object.defineProperty(main(), 'offsetHeight', { configurable: true, get: () => 700 }) // what the person was looking at
    currentRoute.value = 'search'
    rerender(<App />)
    expect(footer().className).not.toContain('invisible') // a new page starts unsettled, but the footer does not blink away
    expect(main().style.minHeight).toBe('700px') // and it stays where it was instead of jumping up under a half-loaded page

    act(() => { vi.advanceTimersByTime(400) })
    expect(footer().className).not.toContain('invisible')
    expect(main().style.minHeight).toBe('') // released: main is exactly as tall as its content again (DECISIONS #108)
  })
})
