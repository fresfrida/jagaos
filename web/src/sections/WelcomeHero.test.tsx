import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const login = vi.fn()
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => ({ login }) }))
vi.mock('../router/navigate', () => ({ navigate: vi.fn() }))

import { DEMO_OWNER_EMAIL } from '../config/demo'
import { DemoPickerHost } from '../features/auth/DemoPickerHost'
import { navigate } from '../router/navigate'
import { HERO_PLAYBACK_RATE, HERO_POSTER } from './HeroVideo'
import { WelcomeHero } from './WelcomeHero'

/** jsdom has no `matchMedia`; this is the person's "reduce motion" setting, on or off. */
function reduceMotion(on: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: on && query.includes('prefers-reduced-motion'), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
}
let play: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  await i18n.changeLanguage('en')
  login.mockReset()
  vi.mocked(navigate).mockReset()
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined) // jsdom cannot play media
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'matchMedia')
})

const HERO_KEYS = [
  'home.hero.headline', 'home.hero.subhead', 'home.hero.imageAlt', 'home.hero.videoAlt', 'home.hero.caption',
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

  it('plays a screen recording of the live app in the phone frame: muted, looping, inline, autoplaying, opening on its poster (DECISIONS #113)', () => {
    render(<><WelcomeHero /><DemoPickerHost /></>)
    const frame = screen.getByTestId('hero-phone')
    const video = frame.querySelector('video')!
    expect(video).toBeTruthy()
    expect(frame.querySelector('img')).toBeNull() // the still is only for reduced motion
    expect(video.autoplay).toBe(true)
    expect(video.loop).toBe(true)
    expect(video.muted).toBe(true) // muted, or a browser will not autoplay it
    expect(video.hasAttribute('playsinline')).toBe(true) // or iOS takes it full screen
    expect(video.getAttribute('poster')).toBe(HERO_POSTER)
    expect(video.getAttribute('aria-label')).toBe('A screen recording of the JagaOS calendar on a phone, switching between English, Chinese, Malay and Tamil.')
    expect(Number(video.getAttribute('width')) / Number(video.getAttribute('height'))).toBeCloseTo(375 / 812, 2) // the size it was recorded at: no layout jump
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('plays at 1.8x, set as the default rate too so a reload of the media cannot slow it (DECISIONS #118)', () => {
    render(<><WelcomeHero /><DemoPickerHost /></>)
    const video = screen.getByTestId('hero-phone').querySelector('video')!
    expect(video.playbackRate).toBe(HERO_PLAYBACK_RATE)
    expect(video.defaultPlaybackRate).toBe(HERO_PLAYBACK_RATE)
    expect(HERO_PLAYBACK_RATE).toBe(1.8)
  })

  it('has a one-line caption under the video and its button, as the figure\'s own <figcaption> (DECISIONS #118)', () => {
    render(<><WelcomeHero /><DemoPickerHost /></>)
    const frame = screen.getByTestId('hero-phone')
    const caption = frame.querySelector('figcaption')!
    expect(caption.textContent).toBe('Your document calendar, in four languages.')
    expect(caption.parentElement).toBe(frame)
    expect(caption.previousElementSibling!.querySelector('button')!.textContent).toBe('Pause video') // right after the toggle's row, so under both
    expect(within(frame).getByRole('button', { name: 'Pause video' })).toBeTruthy()
    expect(frame.tagName).toBe('FIGURE') // the caption is a real <figcaption> of a real <figure>; the figure's computed name is checked in a real browser (jsdom's naming does not do figcaption)
  })

  it.each([
    ['zh', '您的文件日历，支持四种语言。'],
    ['ms', 'Kalendar dokumen anda, dalam empat bahasa.'],
    ['ta', 'உங்கள் ஆவண நாட்காட்டி, நான்கு மொழிகளில்.'],
  ])('the caption is translated (%s)', async (language, text) => {
    await i18n.changeLanguage(language)
    render(<><WelcomeHero /><DemoPickerHost /></>)
    expect(screen.getByTestId('hero-phone').querySelector('figcaption')!.textContent).toBe(text)
  })

  it('under reduced motion the caption is still there, under the still', () => {
    reduceMotion(true)
    render(<><WelcomeHero /><DemoPickerHost /></>)
    const frame = screen.getByTestId('hero-phone')
    expect(frame.querySelector('figcaption')!.textContent).toBe('Your document calendar, in four languages.')
    expect(frame.querySelector('button')).toBeNull()
  })

  it('offers H.264 first, then VP9 for a browser built without it', () => {
    render(<><WelcomeHero /><DemoPickerHost /></>)
    const sources = [...screen.getByTestId('hero-phone').querySelectorAll('video source')]
    expect(sources.map((s) => s.getAttribute('type'))).toEqual(['video/mp4', 'video/webm'])
    for (const source of sources) expect(source.getAttribute('src')).toBeTruthy()
  })

  it('a browser that refuses to autoplay leaves the poster showing: the refusal is swallowed, the video stays', async () => {
    play.mockRejectedValue(new DOMException('play() failed', 'NotAllowedError'))
    render(<><WelcomeHero /><DemoPickerHost /></>)
    await Promise.resolve()
    expect(screen.getByTestId('hero-phone').querySelector('video')).toBeTruthy()
    expect(screen.getByTestId('hero-phone').querySelector('video')!.getAttribute('poster')).toBe(HERO_POSTER)
  })

  it('with reduced motion asked for, the whole video is replaced by its first frame as a picture, and nothing plays', () => {
    reduceMotion(true)
    render(<><WelcomeHero /><DemoPickerHost /></>)
    const frame = screen.getByTestId('hero-phone')
    expect(frame.querySelector('video')).toBeNull()
    expect(play).not.toHaveBeenCalled()
    const still = within(frame).getByRole('img') as HTMLImageElement
    expect(still.getAttribute('src')).toBe(HERO_POSTER)
    expect(still.alt).toBe('The JagaOS calendar on a phone, showing documents by the day they were uploaded.')
    expect(Number(still.getAttribute('width')) / Number(still.getAttribute('height'))).toBeCloseTo(375 / 812, 2)
  })

  it('with reduced motion NOT asked for, it is the video', () => {
    reduceMotion(false)
    render(<><WelcomeHero /><DemoPickerHost /></>)
    expect(screen.getByTestId('hero-phone').querySelector('video')).toBeTruthy()
  })

  it.each([
    ['zh', '手机上的 JagaOS 日历屏幕录制，依次切换英文、中文、马来文和泰米尔文。'],
    ['ms', 'Rakaman skrin kalendar JagaOS pada telefon, bertukar antara bahasa Inggeris, Cina, Melayu dan Tamil.'],
    ['ta', 'தொலைபேசியில் JagaOS நாட்காட்டியின் திரைப் பதிவு, ஆங்கிலம், சீனம், மலாய், தமிழ் மொழிகளுக்கு மாறுகிறது.'],
  ])('describes the recording in %s too', async (language, label) => {
    await i18n.changeLanguage(language)
    render(<><WelcomeHero /><DemoPickerHost /></>)
    expect(screen.getByTestId('hero-phone').querySelector('video')!.getAttribute('aria-label')).toBe(label)
  })

  it('opens up the left column from lg and leaves the phone and tablet spacing exactly as it was (round 3, item 6, DECISIONS #121)', () => {
    const { container } = render(<WelcomeHero />)
    const section = container.querySelector('section') as HTMLElement
    const heading = screen.getByRole('heading', { level: 1 })
    const subhead = heading.nextElementSibling as HTMLElement
    const cta = subhead.nextElementSibling as HTMLElement
    const hint = cta.querySelector('p') as HTMLElement

    // Below lg: the values the page had before, untouched. From lg: one step more, at each of the four places.
    expect(section.className).toContain('pt-8')
    expect(section.className).toContain('sm:pt-14')
    expect(section.className).toContain('lg:pt-20')
    expect(subhead.className).toMatch(/(^|\s)mt-4(\s|$)/)
    expect(subhead.className).toContain('lg:mt-6')
    expect(cta.className).toMatch(/(^|\s)mt-7(\s|$)/)
    expect(cta.className).toContain('lg:mt-11')
    expect(hint.className).toMatch(/(^|\s)mt-2(\s|$)/)
    expect(hint.className).toContain('lg:mt-3')
  })

  // The gradient itself (sage at 6%, ending transparent, pure-white cards) lives in index.css, which vitest cannot read as text (it blanks
  // stylesheets); it was checked by sampling real pixels in Chromium, DECISIONS #121. What is pinned here is the structure around it.
  it('has one soft sage wash behind the hero: a decoration on its own layer, under everything, and not around the cards (round 3, item 7)', () => {
    const { container } = render(<WelcomeHero />)
    const section = container.querySelector('section') as HTMLElement
    const wash = screen.getByTestId('hero-wash')

    expect(container.querySelectorAll('.hero-wash')).toHaveLength(1)
    expect(section.contains(wash)).toBe(true)
    expect(section.className).toContain('isolate') // its own stacking context, so -z-10 stays inside this section
    expect(wash.className).toContain('-z-10')
    expect(wash.className).toContain('pointer-events-none')
    expect(wash.getAttribute('aria-hidden')).toBe('true')
    expect(wash.children).toHaveLength(0) // a decoration, holding nothing
    expect(wash.contains(screen.getByRole('heading', { level: 1 }))).toBe(false)
    for (const card of container.querySelectorAll('section ul li > div')) {
      expect(wash.contains(card)).toBe(false)
      expect(card.className).toContain('bg-white') // the cards paint an opaque white, so nothing shows through them
    }
  })

  it('has three cards, Capture, Review and Remember, and the page ends after them', () => {
    render(<><WelcomeHero /><DemoPickerHost /></>)
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Capture', 'Review', 'Remember'])
    expect(screen.getByText('A photo becomes a filed document.')).toBeTruthy()
    expect(screen.getByText('It reads. You confirm.')).toBeTruthy()
    expect(screen.getByText('Nothing gets lost. Everything stays one search away.')).toBeTruthy()
    expect(screen.queryByText('Deadlines surface before they cost you.')).toBeNull()
  })

  it('the card descriptions are semibold, the same weight as their titles, and still muted (DECISIONS #111)', () => {
    render(<><WelcomeHero /><DemoPickerHost /></>)
    for (const text of ['A photo becomes a filed document.', 'It reads. You confirm.', 'Nothing gets lost. Everything stays one search away.']) {
      const description = screen.getByText(text)
      expect(description.className, text).toContain('font-semibold')
      expect(description.className, text).not.toContain('font-bold') // bold would outweigh the 600-weight title above it
      expect(description.className, text).toContain('text-muted') // weight only; the colour did not change
    }
    for (const title of screen.getAllByRole('heading', { level: 2 })) expect(title.className).toContain('font-semibold')
  })

  it('the line under the demo button names the roles in brackets and reads at 16px, not 14 (DECISIONS #111)', () => {
    render(<><WelcomeHero /><DemoPickerHost /></>)
    const hint = screen.getByText('See the app as (owner, admin, user, viewer). No sign-up needed.')
    expect(hint.className).toContain('text-base')
    expect(hint.className).not.toContain('text-[14px]')
    expect(hint.className).toContain('text-muted') // size only
  })

  it.each([
    ['zh', '以不同身份体验（所有者、管理员、用户、查看者），无需注册。'],
    ['ms', 'Lihat aplikasi sebagai (pemilik, pentadbir, pengguna, pelihat). Tidak perlu mendaftar.'],
    ['ta', 'ஆப்பை (உரிமையாளர், நிர்வாகி, பயனர், பார்வையாளர்) ஆகப் பாருங்கள். பதிவு தேவையில்லை.'],
  ])('the same line, with the four roles in brackets, in %s', async (language, text) => {
    await i18n.changeLanguage(language)
    render(<><WelcomeHero /><DemoPickerHost /></>)
    expect(screen.getByText(text)).toBeTruthy()
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
