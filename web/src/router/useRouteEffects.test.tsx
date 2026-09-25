/** What a route change does to the scroll position (DECISIONS #106): a new page opens at the top; Back, Forward and a reload
 * put the page where it was left. */

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedRoute } from './routes'
import { useRouteEffects } from './useRouteEffects'

let scrollY = 0
const scrollTo = vi.fn((_x: number, y: number) => { scrollY = y })

function Probe({ route }: { route: ResolvedRoute }) {
  useRouteEffects(route)
  return <main id="main" tabIndex={-1} />
}

beforeEach(() => {
  vi.useFakeTimers()
  scrollY = 0
  scrollTo.mockClear()
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => 5000 })
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  window.history.replaceState(null, '', '/calendar')
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useRouteEffects', () => {
  it('a page reached by a link opens at the top', () => {
    const { rerender } = render(<Probe route="calendar" />)
    scrollTo.mockClear()
    window.history.pushState(null, '', '/company-files') // a pushed entry: no saved position
    rerender(<Probe route="company-files" />)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('Back to an entry with a saved position puts the page there instead of at the top', () => {
    const { rerender } = render(<Probe route="company-files" />)
    scrollTo.mockClear()
    window.history.replaceState({ scrollY: 1274 }, '', '/calendar') // the entry Back arrives at
    rerender(<Probe route="calendar" />)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith(0, 1274)
    expect(scrollTo).not.toHaveBeenCalledWith(0, 0)
  })

  it('a reload with a saved position restores it; a first visit does nothing', () => {
    window.history.replaceState({ scrollY: 900 }, '', '/company-files')
    render(<Probe route="company-files" />)
    expect(scrollTo).toHaveBeenCalledWith(0, 900)
    cleanup()
    scrollTo.mockClear()
    window.history.replaceState(null, '', '/company-files')
    render(<Probe route="company-files" />)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('still moves focus to <main> and sets the tab title on every change', () => {
    const { rerender } = render(<Probe route="calendar" />)
    rerender(<Probe route="search" />)
    expect(document.activeElement?.id).toBe('main')
    expect(document.title).toBe('JagaOS: Search')
  })
})
