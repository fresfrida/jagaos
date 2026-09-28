/** The footer, on every page (DECISIONS #106). */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const auth = vi.hoisted(() => ({ value: { status: 'signed-out' } as { status: string } }))
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => auth.value }))

import { FOOTER_LINKS, LEGAL_ENTITY } from '../config/site'
import { PHONE_BOTTOM_NAV_CLEARANCE } from './BottomNav'
import { Footer } from './Footer'

beforeEach(async () => {
  await i18n.changeLanguage('en')
  auth.value = { status: 'signed-out' }
})
afterEach(cleanup)

describe('Footer content', () => {
  it('is the mark, the tagline and the copyright in the LEGAL ENTITY\'s name, verbatim', () => {
    render(<Footer />)
    expect(screen.getByRole('link', { name: 'JagaOS home' })).toBeTruthy()
    expect(screen.getByText("JagaOS keeps your team's memory on record.")).toBeTruthy()
    expect(screen.getByText('© 2026 Platform R PCIB Pte Ltd. All rights reserved.')).toBeTruthy()
    expect(LEGAL_ENTITY).toBe('Platform R PCIB Pte Ltd')
    expect(screen.queryByText(/helps small teams/)).toBeNull() // the old tagline is gone
  })

  it('has three real links, in order, each the real destination from config/site.ts (2026-09-28: the box’s stable /media/* path)', () => {
    render(<Footer />)
    const links = within(screen.getByRole('navigation', { name: 'Footer links' })).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['Watch our intro video', 'Proposal (Business, PDF)', 'Tech Write Up (PDF)'])
    expect(links.map((a) => a.getAttribute('href'))).toEqual(FOOTER_LINKS.map((l) => l.href))
    expect(FOOTER_LINKS.every((l) => l.href.startsWith('https://jagaos.13-251-52-222.nip.io/media/'))).toBe(true) // never '#', never a bare Vercel-relative path
  })

  it('a real link (no longer the old # placeholder) is not intercepted: the click reaches the browser, which opens the new tab', () => {
    render(<Footer />)
    const before = window.location.href
    const allowed = fireEvent.click(screen.getByRole('link', { name: 'Watch our intro video' }))
    expect(allowed).toBe(true) // nothing called preventDefault
    expect(window.location.href).toBe(before) // jsdom does not actually follow target="_blank"; this just confirms THIS window did not navigate
  })

  it('carries none of the old columns or social links', () => {
    render(<Footer />)
    for (const word of ['Solutions', 'Resources', 'Documentation', 'Founders', 'LinkedIn', 'Privacy', 'Terms']) expect(screen.queryByText(word)).toBeNull()
  })

  it.each([
    ['zh', 'JagaOS 为您的团队留存记忆。'],
    ['ms', 'JagaOS menyimpan ingatan pasukan anda dalam rekod.'],
    ['ta', 'JagaOS உங்கள் குழுவின் நினைவைப் பதிவில் வைத்திருக்கிறது.'],
  ])('reads in %s, with the legal name unchanged', async (language, tagline) => {
    await i18n.changeLanguage(language)
    render(<Footer />)
    expect(screen.getByText(tagline)).toBeTruthy()
    expect(document.body.textContent).toContain('© 2026 Platform R PCIB Pte Ltd')
    for (const link of within(screen.getByRole('navigation')).getAllByRole('link')) expect(link.textContent).not.toMatch(/^(Watch our|Proposal \(Business|Tech Write)/)
  })
})

describe('Footer, signed out', () => {
  it('has NO call-to-action button (DECISIONS #111): the header\'s Get Started and the landing page\'s own button are the two', () => {
    const { container } = render(<Footer />)
    expect(screen.queryByRole('button', { name: 'Get Started' })).toBeNull()
    expect(container.querySelectorAll('footer button')).toHaveLength(0)
  })

  it('renders each of the three links exactly once, in ONE nav (there is no second link row under a divider)', () => {
    const { container } = render(<Footer />)
    expect(container.querySelectorAll('footer nav')).toHaveLength(1)
    for (const name of ['Watch our intro video', 'Proposal (Business, PDF)', 'Tech Write Up (PDF)']) expect(screen.getAllByText(name)).toHaveLength(1)
    expect(container.querySelectorAll('footer > div > nav')).toHaveLength(0) // the old row, a nav directly under the container, is gone
  })

  it('does not carry the phone bottom-bar clearance: there is no bar', () => {
    const { container } = render(<Footer />)
    expect(container.querySelector('footer')!.className).not.toContain(PHONE_BOTTOM_NAV_CLEARANCE)
  })
})

describe('Footer, signed in', () => {
  beforeEach(() => { auth.value = { status: 'signed-in' } })

  it('has no Get Started, but keeps everything else', () => {
    render(<Footer />)
    expect(screen.queryByRole('button', { name: 'Get Started' })).toBeNull()
    expect(screen.getByText('© 2026 Platform R PCIB Pte Ltd. All rights reserved.')).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Footer links' })).getAllByRole('link')).toHaveLength(3)
  })

  it('takes the phone bottom bar\'s clearance itself, since it is the last thing on the page', () => {
    const { container } = render(<Footer />)
    expect(container.querySelector('footer')!.className).toContain(PHONE_BOTTOM_NAV_CLEARANCE)
    expect(PHONE_BOTTOM_NAV_CLEARANCE).toContain('6.5rem')
    expect(PHONE_BOTTOM_NAV_CLEARANCE).toContain('env(safe-area-inset-bottom)')
  })
})

describe('Footer layout (DECISIONS #108)', () => {
  it('PHONE: everything is centred in one column, in order: mark, tagline, copyright, then the links', () => {
    const { container } = render(<Footer />)
    const top = container.querySelector('footer > div > div')!
    expect(top.className).toContain('flex-col')
    expect(top.className).toContain('items-center')
    expect(top.className).toContain('text-center')
    const order = [...container.querySelectorAll('footer a, footer p, footer button')].map((n) => n.textContent)
    expect(order).toEqual([
      'JagaOS', "JagaOS keeps your team's memory on record.", '© 2026 Platform R PCIB Pte Ltd. All rights reserved.',
      'Watch our intro video', 'Proposal (Business, PDF)', 'Tech Write Up (PDF)',
    ])
  })

  it('PHONE: the three links are one per row, centred, each a 44px-tall tap target', () => {
    render(<Footer />)
    const list = screen.getByRole('navigation', { name: 'Footer links' }).querySelector('ul')!
    expect(list.className).toContain('flex-col')
    expect(list.className).toContain('items-center')
    for (const link of within(list).getAllByRole('link')) expect(link.className).toContain('min-h-[44px]')
  })

  it('DESKTOP (sm and up): the brand block on the left, the three links STACKED on the right, in the slot Get Started had', () => {
    const { container } = render(<Footer />)
    const top = container.querySelector('footer > div > div')!
    for (const cls of ['sm:flex-row', 'sm:items-start', 'sm:justify-between', 'sm:text-left']) expect(top.className, cls).toContain(cls)
    // The links are the row's second child, right after the brand block: the right-hand slot.
    expect(top.children).toHaveLength(2)
    expect(top.children[1]!.tagName).toBe('NAV')
    const list = screen.getByRole('navigation', { name: 'Footer links' }).querySelector('ul')!
    expect(list.className).toContain('flex-col') // one under another, on a desktop too
    expect(list.className).not.toContain('sm:flex-row')
    expect(list.className).toContain('sm:items-end') // hugging the right edge
    for (const link of within(list).getAllByRole('link')) expect(link.className).toContain('sm:min-h-0') // no tap-target padding on a desktop stack
  })

  it('the links are a step larger and heavier than the muted body text, and NOT a different colour (DECISIONS #111; the shared colour itself inverted for the dark footer, round 4 item 7, DECISIONS #122)', () => {
    render(<Footer />)
    for (const link of within(screen.getByRole('navigation', { name: 'Footer links' })).getAllByRole('link')) {
      expect(link.className).toContain('text-[15px]')
      expect(link.className).toContain('font-medium')
      expect(link.className).toContain('text-white/70')
    }
  })
})

describe('Footer visibility (DECISIONS #108)', () => {
  it('is seen by default', () => {
    const { container } = render(<Footer />)
    expect(container.querySelector('footer')!.className).not.toContain('invisible')
  })

  it('while its page is still loading it is laid out but invisible: no half-page footer to jump down', () => {
    const { container } = render(<Footer visible={false} />)
    const footer = container.querySelector('footer')!
    expect(footer.className).toContain('invisible') // visibility: hidden keeps its space and removes it from the accessibility tree
    expect(footer.className).toContain('opacity-0')
    expect(footer.className).toContain('transition-opacity') // and fades in once the page has settled
    expect(footer.className).toContain('motion-reduce:transition-none')
  })
})

