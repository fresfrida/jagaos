/** The footer's three links (DECISIONS #118): each opens in a NEW TAB, and shipping a real destination is only the href in config/site.ts. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const auth = vi.hoisted(() => ({ value: { status: 'signed-out' } as { status: string } }))
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => auth.value }))
// The config's array is replaced IN PLACE per test, so the Footer's import of it sees whatever the test set.
const links = vi.hoisted(() => [] as Array<{ id: string; href: string }>)
vi.mock('../config/site', async (importActual) => ({ ...(await importActual<typeof import('../config/site')>()), FOOTER_LINKS: links }))

import { FOOTER_LINKS } from '../config/site'
import { Footer } from './Footer'

const setLinks = (video: string, proposal: string, techWriteUp: string) =>
  links.splice(0, links.length, { id: 'video', href: video }, { id: 'proposal', href: proposal }, { id: 'techWriteUp', href: techWriteUp })
const link = (name: string) => screen.getByRole('link', { name }) as HTMLAnchorElement

beforeEach(async () => {
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('Footer links: the shape the real destinations drop into', () => {
  it('all three open in a new tab and cannot reach back into the page (noopener noreferrer), placeholder or not', () => {
    setLinks('#', '#', '#')
    render(<Footer />)
    for (const name of ['Watch our intro video', 'Proposal (Business, PDF)', 'Tech Write Up (PDF)']) {
      expect(link(name).getAttribute('target'), name).toBe('_blank')
      expect(link(name).getAttribute('rel'), name).toBe('noopener noreferrer')
    }
  })

  it('with the real destinations in the config, ONLY the hrefs change: a YouTube URL and two PDFs from the site root, all followed by the browser', () => {
    setLinks('https://youtu.be/abc123', '/jagaos-proposal.pdf', '/jagaos-tech-write-up.pdf')
    render(<Footer />)
    expect(link('Watch our intro video').getAttribute('href')).toBe('https://youtu.be/abc123')
    expect(link('Proposal (Business, PDF)').getAttribute('href')).toBe('/jagaos-proposal.pdf')
    expect(link('Tech Write Up (PDF)').getAttribute('href')).toBe('/jagaos-tech-write-up.pdf')
    for (const name of ['Watch our intro video', 'Proposal (Business, PDF)', 'Tech Write Up (PDF)']) {
      expect(fireEvent.click(link(name)), name).toBe(true) // not prevented: the browser opens it in the new tab
      expect(link(name).getAttribute('target'), name).toBe('_blank')
      expect(link(name).getAttribute('rel'), name).toBe('noopener noreferrer')
    }
  })

  it('a link still `#` stays swallowed while the others are real: it neither jumps the page nor leaves a # behind', () => {
    setLinks('https://youtu.be/abc123', '#', '/jagaos-tech-write-up.pdf') // the user has supplied two of the three
    render(<Footer />)
    const before = window.location.href
    expect(fireEvent.click(link('Proposal (Business, PDF)'))).toBe(false) // preventDefault was called
    expect(window.location.href).toBe(before)
    expect(fireEvent.click(link('Watch our intro video'))).toBe(true)
    expect(fireEvent.click(link('Tech Write Up (PDF)'))).toBe(true)
  })

  it('the links stay visible in the footer whatever they point at, once each, in order', () => {
    setLinks('#', '#', '#')
    render(<Footer />)
    expect(screen.getAllByRole('link').filter((a) => a.getAttribute('target') === '_blank').map((a) => a.textContent))
      .toEqual(['Watch our intro video', 'Proposal (Business, PDF)', 'Tech Write Up (PDF)'])
    expect(FOOTER_LINKS).toHaveLength(3)
  })
})
