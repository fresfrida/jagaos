/** The previous page's height, held while a new page loads (DECISIONS #112), so the footer does not jump up and back down. */

import { cleanup, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { useReservedPageHeight } from './useReservedPageHeight'

function Probe({ pageKey, settled }: { pageKey: string; settled: boolean }) {
  const ref = useRef<HTMLElement>(null)
  const reserved = useReservedPageHeight(pageKey, settled, ref)
  return <main ref={ref} data-testid="main" data-reserved={reserved ?? 'none'} />
}
const reserved = () => screen.getByTestId('main').getAttribute('data-reserved')
/** jsdom has no layout, so the height the browser would report for the page on screen is set by hand. */
const pageIsTall = (px: number) => Object.defineProperty(screen.getByTestId('main'), 'offsetHeight', { configurable: true, get: () => px })

afterEach(cleanup)

describe('useReservedPageHeight', () => {
  it('reserves nothing on the first load: there is no previous page', () => {
    render(<Probe pageKey="home:1" settled={false} />)
    expect(reserved()).toBe('none')
  })

  it('on a page change, reserves the height the OLD page had, in the same render as the new one', () => {
    const { rerender } = render(<Probe pageKey="calendar:1" settled />)
    pageIsTall(730)
    rerender(<Probe pageKey="search:1" settled />) // `settled` is still the old page's true in this render: it must NOT release the hold
    expect(reserved()).toBe('730')
  })

  it('holds it while the new page is unsettled, and lets go once it settles', () => {
    const { rerender } = render(<Probe pageKey="calendar:1" settled />)
    pageIsTall(730)
    rerender(<Probe pageKey="search:1" settled />)
    rerender(<Probe pageKey="search:1" settled={false} />) // usePageSettled resets to false in an effect, one render later
    expect(reserved()).toBe('730')
    rerender(<Probe pageKey="search:1" settled />)
    expect(reserved()).toBe('none') // no standing minimum height (DECISIONS #108)
  })

  it('a company switch is a page change too, and an unmeasurable (zero) height reserves nothing', () => {
    const { rerender } = render(<Probe pageKey="calendar:1" settled />)
    pageIsTall(0)
    rerender(<Probe pageKey="calendar:2" settled={false} />)
    expect(reserved()).toBe('none')
  })
})
