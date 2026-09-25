/** Scroll memory (DECISIONS #106): Back puts the page where it was left. jsdom has no layout, so the page's height and the scroll
 * position are stubbed, and time is faked. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { navigate } from './navigate'
import { rememberScroll, restoreScrollWhenReady, savedScrollY, startScrollMemory } from './scrollMemory'

let scrollY = 0
let pageHeight = 3000
const scrollTo = vi.fn((_x: number, y: number) => { scrollY = y })

beforeEach(() => {
  vi.useFakeTimers()
  scrollY = 0
  pageHeight = 3000
  scrollTo.mockClear()
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => pageHeight })
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  window.history.replaceState(null, '', '/calendar')
})
afterEach(() => { vi.useRealTimers() })

describe('rememberScroll / savedScrollY', () => {
  it('writes the position into the current entry, without adding an entry, and keeps the rest of the state', () => {
    window.history.replaceState({ other: 'kept' }, '', '/calendar?m=2020-03')
    const before = window.history.length
    scrollY = 1274.4
    rememberScroll()
    expect(window.history.state).toEqual({ other: 'kept', scrollY: 1274 })
    expect(window.history.length).toBe(before)
    expect(window.location.search).toBe('?m=2020-03')
    expect(savedScrollY()).toBe(1274)
  })

  it('reads nothing from an entry with no state, junk state, or the top', () => {
    expect(savedScrollY()).toBeNull()
    for (const junk of ['x', 7, [1], { scrollY: 'far' }, { scrollY: NaN }, { scrollY: -5 }, { scrollY: 0 }]) {
      window.history.replaceState(junk, '')
      expect(savedScrollY(), JSON.stringify(junk)).toBeNull()
    }
  })
})

describe('startScrollMemory', () => {
  it('turns the browser\'s own restoration off, and back on when stopped', () => {
    window.history.scrollRestoration = 'auto'
    const stop = startScrollMemory()
    expect(window.history.scrollRestoration).toBe('manual')
    stop()
    expect(window.history.scrollRestoration).toBe('auto')
  })

  it('saves a moment after scrolling STOPS, not on every scroll event', () => {
    const stop = startScrollMemory()
    for (const y of [100, 300, 900]) {
      scrollY = y
      window.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(100) // still moving
    }
    expect(savedScrollY()).toBeNull()
    vi.advanceTimersByTime(250)
    expect(savedScrollY()).toBe(900)
    stop()
  })

  it('a save still pending when the entry changes is dropped, so it cannot write the page being left into the one being entered', () => {
    const stop = startScrollMemory()
    scrollY = 900
    window.dispatchEvent(new Event('scroll'))
    window.history.replaceState({ scrollY: 42 }, '', '/company-files') // Back has switched entries
    window.dispatchEvent(new PopStateEvent('popstate'))
    vi.advanceTimersByTime(1000)
    expect(savedScrollY()).toBe(42)
    stop()
  })
})

describe('navigate saves the position of the page it leaves', () => {
  it('immediately, before the push, so a click right after a scroll leaves nothing stale', () => {
    const stop = startScrollMemory()
    scrollY = 640
    window.dispatchEvent(new Event('scroll')) // the debounced save has NOT fired yet
    navigate('/company-files')
    expect(window.location.pathname).toBe('/company-files')
    expect(savedScrollY()).toBeNull() // the new entry starts with none: a pushed page opens at the top
    window.history.back()
    return vi.waitFor(() => expect(window.location.pathname).toBe('/calendar')).then(() => {
      expect(savedScrollY()).toBe(640) // and the entry left kept it
      stop()
    })
  })
})

describe('restoreScrollWhenReady', () => {
  it('scrolls at once when the page is already tall enough', () => {
    restoreScrollWhenReady(1200)
    expect(scrollTo).toHaveBeenCalledWith(0, 1200)
  })

  it('waits for a page that is still loading, then scrolls the moment it can reach the position', () => {
    pageHeight = 900 // the list has not arrived
    restoreScrollWhenReady(1200)
    vi.advanceTimersByTime(1500)
    expect(scrollTo).not.toHaveBeenCalled()
    pageHeight = 3000 // it arrived
    vi.advanceTimersByTime(100)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith(0, 1200)
    vi.advanceTimersByTime(5000)
    expect(scrollTo).toHaveBeenCalledTimes(1) // and it stopped
  })

  it('gives up after a few seconds and goes as far as the page goes, when the content is shorter than it was', () => {
    pageHeight = 1500 // reachable: 700
    restoreScrollWhenReady(2000)
    vi.advanceTimersByTime(4200)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith(0, 700)
  })

  it.each(['wheel', 'touchstart', 'keydown', 'mousedown'])('does not fight the person: a %s before the page is ready cancels it', (type) => {
    pageHeight = 900
    restoreScrollWhenReady(1200)
    window.dispatchEvent(new Event(type))
    pageHeight = 3000
    vi.advanceTimersByTime(5000)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('can be cancelled by the caller (the next route change)', () => {
    pageHeight = 900
    const cancel = restoreScrollWhenReady(1200)
    cancel()
    pageHeight = 3000
    vi.advanceTimersByTime(5000)
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
