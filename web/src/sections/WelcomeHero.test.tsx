import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  vi.mocked(navigate).mockReset()
})
afterEach(cleanup)

const HERO_KEYS = [
  'home.hero.headline', 'home.hero.subhead', 'home.hero.imageAlt',
  'home.features.capture.title', 'home.features.capture.text', 'home.features.review.title', 'home.features.review.text',
  'home.features.remember.title', 'home.features.remember.text',
  'home.how.heading', 'home.how.upload', 'home.how.read', 'home.how.confirm', 'home.closing',
]

describe('WelcomeHero', () => {
  it('says what JagaOS does in one line, one supporting sentence, and offers the demo picker', () => {
    render(<WelcomeHero />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("JagaOS remembers, so you don't need to.")
    expect(screen.getByText('Upload a document. JagaOS reads it, finds the dates and obligations, and keeps everything one search away.')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Pick a demo role' })).toHaveLength(2) // the hero's, and the one under the closing line
  })

  it('shows a real screenshot of the app in a phone frame, with a description for people who cannot see it', () => {
    render(<WelcomeHero />)
    const shot = within(screen.getByTestId('hero-phone')).getByRole('img') as HTMLImageElement
    expect(shot.getAttribute('src')).toBeTruthy()
    expect(shot.alt).toBe('The JagaOS calendar on a phone, showing documents by the day they were uploaded.')
    expect(Number(shot.getAttribute('width')) / Number(shot.getAttribute('height'))).toBeCloseTo(375 / 812, 1) // the size it was taken at: no layout jump
  })

  it('has three cards, Capture, Review and Remember, then a How it works strip', () => {
    render(<WelcomeHero />)
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Capture', 'Review', 'Remember', 'How it works'])
    expect(screen.getByText('A photo becomes a filed document.')).toBeTruthy()
    expect(screen.getByText('It reads. You confirm.')).toBeTruthy()
    expect(screen.getByText('Deadlines surface before they cost you.')).toBeTruthy()
  })

  it('the How it works strip is three beats in order: Upload. Read. Confirm.', () => {
    render(<WelcomeHero />)
    const beats = within(screen.getByTestId('how-it-works')).getAllByRole('listitem').map((li) => li.textContent)
    expect(beats).toEqual(['1Upload.', '2Read.', '3Confirm.'])
  })

  it('ends on a closing line, above the call to action again', () => {
    render(<WelcomeHero />)
    const closing = screen.getByTestId('closing')
    expect(within(closing).getByText('So you can focus on the work that matters.')).toBeTruthy()
    expect(within(closing).getByRole('button', { name: 'Pick a demo role' })).toBeTruthy()
  })

  it('has no Sign in button in the body: the header\'s Log In is where a returning person signs in', () => {
    render(<WelcomeHero />)
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
    expect(screen.queryByText('Use your own email, or set up a new company.')).toBeNull()
    expect(screen.queryAllByRole('link')).toHaveLength(0) // the page body links nowhere: one call to action, the demo
  })

  it.each(['en', 'zh', 'ms', 'ta'])('the copy is quiet in %s: no exclamation marks, no em dashes, nothing left in English but the name', async (language) => {
    await i18n.changeLanguage(language)
    for (const key of HERO_KEYS) {
      const text = i18n.t(key)
      expect(text, key).not.toBe(key) // a real string, not the key echoed back
      expect(text, key).not.toMatch(/[!！—]/)
      if (language !== 'en') expect(text, key).not.toBe(i18n.t(key, { lng: 'en' }))
    }
    await i18n.changeLanguage('en')
  })

  it('the button under the closing line opens the same picker', () => {
    render(<WelcomeHero />)
    fireEvent.click(within(screen.getByTestId('closing')).getByRole('button', { name: 'Pick a demo role' }))
    expect(screen.getByRole('dialog', { name: 'Try the demo as' })).toBeTruthy()
    expect(login).not.toHaveBeenCalled()
  })

  it('the demo button opens the picker and signs nobody in by itself', () => {
    render(<WelcomeHero />)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getAllByRole('button', { name: 'Pick a demo role' })[0]!)

    expect(screen.getByRole('dialog', { name: 'Try the demo as' })).toBeTruthy()
    expect(login).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('choosing the owner in the picker is the ordinary login with the demo owner email, then the same landing page as the form', async () => {
    login.mockResolvedValue(undefined)
    render(<WelcomeHero />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Pick a demo role' })[0]!)

    fireEvent.click(screen.getByRole('button', { name: /^Owner/ }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
    expect(login).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenCalledWith({ email: DEMO_OWNER_EMAIL })
    expect(DEMO_OWNER_EMAIL).toBe('owner@try-demo.test')
  })
})
