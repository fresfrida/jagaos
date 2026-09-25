import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const login = vi.fn()
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => ({ login }) }))
vi.mock('../router/navigate', () => ({ navigate: vi.fn() }))

import { DEMO_OWNER_EMAIL } from '../config/demo'
import { DemoPickerHost } from '../features/auth/DemoPickerHost'
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
]

describe('WelcomeHero', () => {
  it('says what JagaOS does in one line, one supporting sentence, and offers the demo picker', () => {
    render(<><WelcomeHero /><DemoPickerHost /></>)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe("JagaOS remembers, so you don't need to.")
    expect(screen.getByText('Upload a document. JagaOS reads it, finds the dates and details, and keeps everything one search away.')).toBeTruthy()
    expect(screen.queryByText(/obligations/i)).toBeNull() // the subhead no longer promises them (DECISIONS #108)
    expect(screen.getAllByRole('button', { name: 'Pick a demo role' })).toHaveLength(1) // the hero's: the closing section's second button is gone
  })

  it('shows a real screenshot of the app in a phone frame, with a description for people who cannot see it', () => {
    render(<><WelcomeHero /><DemoPickerHost /></>)
    const shot = within(screen.getByTestId('hero-phone')).getByRole('img') as HTMLImageElement
    expect(shot.getAttribute('src')).toBeTruthy()
    expect(shot.alt).toBe('The JagaOS calendar on a phone, showing documents by the day they were uploaded.')
    expect(Number(shot.getAttribute('width')) / Number(shot.getAttribute('height'))).toBeCloseTo(375 / 812, 1) // the size it was taken at: no layout jump
  })

  it('has three cards, Capture, Review and Remember, and the page ends after them', () => {
    render(<><WelcomeHero /><DemoPickerHost /></>)
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Capture', 'Review', 'Remember'])
    expect(screen.getByText('A photo becomes a filed document.')).toBeTruthy()
    expect(screen.getByText('It reads. You confirm.')).toBeTruthy()
    expect(screen.getByText('Nothing gets lost. Everything stays one search away.')).toBeTruthy()
    expect(screen.queryByText('Deadlines surface before they cost you.')).toBeNull()
  })

  it('has no "How it works" section any more (DECISIONS #106): no heading, no Upload. Read. Confirm. beats', () => {
    render(<><WelcomeHero /><DemoPickerHost /></>)
    expect(screen.queryByTestId('how-it-works')).toBeNull()
    expect(screen.queryByText('How it works')).toBeNull()
    for (const beat of ['Upload.', 'Read.', 'Confirm.']) expect(screen.queryByText(beat)).toBeNull()
    expect(i18n.exists('home.how.heading')).toBe(false) // and the strings went with it
  })

  it('has NO closing section: no closing line, no second call to action; the page ends after the three cards (DECISIONS #108)', () => {
    const { container } = render(<><WelcomeHero /><DemoPickerHost /></>)
    expect(screen.queryByTestId('closing')).toBeNull()
    expect(screen.queryByText('So you can focus on the work that matters.')).toBeNull()
    expect(i18n.exists('home.closing')).toBe(false) // and its strings went with it
    const cards = screen.getByRole('list')
    expect(container.querySelector('section')!.lastElementChild!.lastElementChild).toBe(cards) // the cards are the last thing in the page
  })

  it('has no Sign in button in the body, and no Log In anywhere: the demo picker is the one way in', () => {
    render(<><WelcomeHero /><DemoPickerHost /></>)
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

  it('the demo button opens the picker and signs nobody in by itself', () => {
    render(<><WelcomeHero /><DemoPickerHost /></>)
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Pick a demo role' }))

    expect(screen.getByRole('dialog', { name: 'Try the demo as' })).toBeTruthy()
    expect(login).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('choosing the owner in the picker is the ordinary login with the demo owner email, then the same landing page as the form', async () => {
    login.mockResolvedValue(undefined)
    render(<><WelcomeHero /><DemoPickerHost /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Pick a demo role' }))

    fireEvent.click(screen.getByRole('button', { name: /^Owner/ }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
    expect(login).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenCalledWith({ email: DEMO_OWNER_EMAIL })
    expect(DEMO_OWNER_EMAIL).toBe('owner@try-demo.test')
  })
})
