/** The logo (DECISIONS #114): the supplied mark and the wordmark, in one link home. It replaced a flat black rounded square.
 * Round 5, item 1 (DECISIONS #125): the mark is now adaptive — `variant="onLight"` (the original: ink tile, white thread) or
 * `variant="onDark"` (the inverted: off-white tile, ink thread), for a light or a dark surface respectively; the header and
 * footer, both dark bars since round 4, use `onDark`. */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Logo } from './Logo'

afterEach(cleanup)

describe('Logo', () => {
  it('is one link home, named "JagaOS home", with the wordmark beside the mark', () => {
    render(<Logo variant="onDark" />)
    const link = screen.getByRole('link', { name: 'JagaOS home' })
    expect(link.getAttribute('href')).toBe('/')
    expect(link.textContent).toBe('JagaOS')
  })

  it('shows the real mark as an inline SVG, 28px, decorative (the link and the wordmark name it), whichever variant', () => {
    for (const variant of ['onLight', 'onDark'] as const) {
      const { container } = render(<Logo variant={variant} />)
      const mark = container.querySelector('svg')!
      expect(mark, variant).toBeTruthy()
      expect(mark.getAttribute('aria-hidden'), variant).toBe('true') // decorative: a screen reader gets "JagaOS home" once, not twice
      expect(mark.getAttribute('viewBox'), variant).toBe('0 0 320 320') // cropped to the icon tile alone, not the full lockup canvas
      expect(mark.className.baseVal, variant).toContain('h-7')
      expect(mark.className.baseVal, variant).toContain('w-7')
      cleanup()
    }
  })

  it("carries the thread mark's dot as a real, separately paintable node with the pulse animation, and nothing else in the mark animates", () => {
    const { container } = render(<Logo variant="onDark" />)
    const dot = container.querySelector('circle#thread-dot')!
    expect(dot).toBeTruthy()
    expect(dot.getAttribute('class')).toContain('thread-dot-pulse')
    expect(container.querySelectorAll('.thread-dot-pulse')).toHaveLength(1)
  })

  it('onLight draws the ORIGINAL mark (ink tile, white thread) with an ink wordmark, for a light background', () => {
    const { container } = render(<Logo variant="onLight" />)
    expect(container.querySelector('rect#tile')!.getAttribute('fill')).toBe('#141414')
    expect(container.querySelector('#thread-mark path')!.getAttribute('stroke')).toBe('#ffffff')
    expect(container.querySelector('circle#thread-dot')!.getAttribute('fill')).toBe('#ffffff') // the dot matches the thread, never sage
    expect(screen.getByText('JagaOS').className).toContain('text-ink')
  })

  it('onDark draws the INVERTED mark (off-white tile, ink thread) with a white wordmark, for a dark background', () => {
    const { container } = render(<Logo variant="onDark" />)
    expect(container.querySelector('rect#tile')!.getAttribute('fill')).toBe('#f5f7f5')
    expect(container.querySelector('#thread-mark path')!.getAttribute('stroke')).toBe('#141414')
    expect(container.querySelector('circle#thread-dot')!.getAttribute('fill')).toBe('#141414') // the dot matches the thread, never sage
    expect(screen.getByText('JagaOS').className).toContain('text-white')
  })

  it('the sage inner stroke is unchanged between variants — sage never appears on the dot', () => {
    for (const variant of ['onLight', 'onDark'] as const) {
      const { container } = render(<Logo variant={variant} />)
      const sageStroke = container.querySelector('path[stroke="#6ea99d"]')
      expect(sageStroke, variant).toBeTruthy()
      expect(container.querySelector('circle#thread-dot')!.getAttribute('fill'), variant).not.toBe('#6ea99d')
      cleanup()
    }
  })
})
