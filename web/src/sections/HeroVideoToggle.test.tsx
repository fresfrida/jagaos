/** The pause / play button under the landing page's demo video (DECISIONS #115; WCAG 2.2.2). */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { WelcomeHero } from './WelcomeHero'

/** jsdom plays no media, so play and pause are stood in for and fire the events a browser fires. */
let paused = true
let play: ReturnType<typeof vi.spyOn>
let pause: ReturnType<typeof vi.spyOn>

function reduceMotion(on: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: on && query.includes('prefers-reduced-motion'), media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  paused = true
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    paused = false
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  })
  pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    paused = true
    this.dispatchEvent(new Event('pause'))
  })
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'matchMedia')
})

const frame = () => screen.getByTestId('hero-phone')
const video = () => frame().querySelector('video')!

describe('the demo video\'s pause button', () => {
  it('is under the phone frame, not on the picture, and reads "Pause video" while the video plays', () => {
    render(<WelcomeHero />)
    const button = within(frame()).getByRole('button', { name: 'Pause video' })
    expect(button.closest('figure')).toBe(frame())
    expect(video().parentElement!.parentElement!.contains(button)).toBe(false) // outside the bezel that holds the video
    expect(button.className).toContain('min-h-[44px]') // a phone tap target, like the app's other controls
    expect(button.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true') // the word is the name; the icon is decoration
  })

  it('pauses on click, freezing the frame it is on, and the button turns into "Play video"; pressing again resumes', () => {
    render(<WelcomeHero />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause video' }))
    expect(pause).toHaveBeenCalledTimes(1)
    expect(paused).toBe(true)
    expect(video()).toBeTruthy() // still the video, held on its frame: not swapped for the poster
    expect(screen.queryByRole('button', { name: 'Pause video' })).toBeNull()

    play.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }))
    expect(play).toHaveBeenCalledTimes(1)
    expect(paused).toBe(false)
    expect(screen.getByRole('button', { name: 'Pause video' })).toBeTruthy()
  })

  it('resuming after a pause keeps the 1.8x rate (DECISIONS #118)', () => {
    render(<WelcomeHero />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause video' }))
    fireEvent.click(screen.getByRole('button', { name: 'Play video' }))
    expect(video().playbackRate).toBe(1.8)
  })

  it('follows what the video does by itself: a browser that pauses it (scrolled away, low power) makes the button read "Play video"', () => {
    render(<WelcomeHero />)
    act(() => { video().dispatchEvent(new Event('pause')) })
    expect(screen.getByRole('button', { name: 'Play video' })).toBeTruthy()
    act(() => { video().dispatchEvent(new Event('play')) })
    expect(screen.getByRole('button', { name: 'Pause video' })).toBeTruthy()
  })

  it('a browser that refuses to autoplay leaves the poster and a "Play video" button that starts it', async () => {
    play.mockRejectedValueOnce(new DOMException('play() failed', 'NotAllowedError'))
    render(<WelcomeHero />)
    await act(async () => { await Promise.resolve() })
    const button = screen.getByRole('button', { name: 'Play video' })
    expect(video().getAttribute('poster')).toBeTruthy()
    fireEvent.click(button)
    expect(screen.getByRole('button', { name: 'Pause video' })).toBeTruthy()
  })

  it('with reduced motion asked for there is a still and NO button: nothing moves, so there is nothing to pause', () => {
    reduceMotion(true)
    render(<WelcomeHero />)
    expect(frame().querySelector('video')).toBeNull()
    expect(within(frame()).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('button', { name: /video/i })).toBeNull()
    expect(play).not.toHaveBeenCalled()
  })

  it.each([
    ['the last source failing', () => frame().querySelector('source:last-of-type')!],
    ['the video failing to decode', () => video()],
  ])('has no button when nothing can be played (%s): it would do nothing', (_, target) => {
    render(<WelcomeHero />)
    expect(screen.getByRole('button', { name: 'Pause video' })).toBeTruthy()
    fireEvent.error(target())
    expect(within(frame()).queryByRole('button')).toBeNull()
  })

  it.each([
    ['zh', '暂停视频', '播放视频'],
    ['ms', 'Jeda video', 'Mainkan video'],
    ['ta', 'வீடியோவை இடைநிறுத்து', 'வீடியோவை இயக்கு'],
  ])('is named in %s in both states', async (language, pauseName, playName) => {
    await i18n.changeLanguage(language)
    render(<WelcomeHero />)
    fireEvent.click(screen.getByRole('button', { name: pauseName }))
    expect(screen.getByRole('button', { name: playName })).toBeTruthy()
  })
})
