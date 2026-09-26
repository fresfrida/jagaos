/** The logo (DECISIONS #114): the supplied mark and the wordmark, in one link home. It replaced a flat black rounded square. */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Logo } from './Logo'

afterEach(cleanup)

describe('Logo', () => {
  it('is one link home, named "JagaOS home", with the wordmark beside the mark', () => {
    render(<Logo />)
    const link = screen.getByRole('link', { name: 'JagaOS home' })
    expect(link.getAttribute('href')).toBe('/')
    expect(link.textContent).toBe('JagaOS')
  })

  it('shows the real mark as an inline SVG, 28px, decorative (the link and the wordmark name it) — round 4, item 8c, DECISIONS #122', () => {
    const { container } = render(<Logo />)
    const mark = container.querySelector('svg')!
    expect(mark).toBeTruthy()
    expect(mark.getAttribute('aria-hidden')).toBe('true') // decorative: a screen reader gets "JagaOS home" once, not twice
    expect(mark.getAttribute('viewBox')).toBe('0 0 320 320') // cropped to the icon tile alone, not the full lockup canvas
    expect(mark.className.baseVal).toContain('h-7')
    expect(mark.className.baseVal).toContain('w-7')
  })

  it("carries the thread mark's dot as a real, separately paintable node with the pulse animation, and nothing else in the mark animates", () => {
    const { container } = render(<Logo />)
    const dot = container.querySelector('circle#thread-dot')!
    expect(dot).toBeTruthy()
    expect(dot.getAttribute('class')).toContain('thread-dot-pulse')
    expect(container.querySelectorAll('.thread-dot-pulse')).toHaveLength(1)
  })
})
