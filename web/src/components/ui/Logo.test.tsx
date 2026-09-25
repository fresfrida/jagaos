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

  it('shows the real mark as an image, 28px, decorative (the link and the wordmark name it), and no longer a flat black square', () => {
    const { container } = render(<Logo />)
    const mark = container.querySelector('img')!
    expect(mark).toBeTruthy()
    expect(mark.getAttribute('src')).toMatch(/logo-mark/)
    expect(mark.getAttribute('alt')).toBe('') // decorative: a screen reader gets "JagaOS home" once, not twice
    expect(mark.getAttribute('width')).toBe('28')
    expect(mark.getAttribute('height')).toBe('28')
    expect(mark.className).toContain('h-7')
    expect(mark.className).toContain('w-7')
    expect(container.querySelector('.bg-ink')).toBeNull() // the placeholder was `<span class="h-7 w-7 rounded-lg bg-ink">`
    expect(mark.className).not.toContain('rounded') // it carries its own rounded corners (transparent PNG)
  })
})
