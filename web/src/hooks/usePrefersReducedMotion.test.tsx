/** The person's "reduce motion" setting (DECISIONS #113): read now, and followed if it changes while the page is open. */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

function Probe() {
  return <p data-testid="reduce">{String(usePrefersReducedMotion())}</p>
}
const reduce = () => screen.getByTestId('reduce').textContent

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'matchMedia')
})

describe('usePrefersReducedMotion', () => {
  it('reads as "no preference" where there is no matchMedia at all (an old browser, a test)', () => {
    render(<Probe />)
    expect(reduce()).toBe('false')
  })

  it.each([[true, 'true'], [false, 'false']])('reads the system setting (%s)', (matches, expected) => {
    window.matchMedia = vi.fn().mockReturnValue({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    render(<Probe />)
    expect(reduce()).toBe(expected)
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  })

  it('follows the setting when it changes while the page is open, and stops listening when it goes', () => {
    const query = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    window.matchMedia = vi.fn().mockReturnValue(query)
    const { unmount } = render(<Probe />)
    expect(reduce()).toBe('false')

    const onChange = query.addEventListener.mock.calls[0]![1] as () => void
    query.matches = true
    act(() => onChange())
    expect(reduce()).toBe('true')

    unmount()
    expect(query.removeEventListener).toHaveBeenCalledWith('change', onChange)
  })
})
