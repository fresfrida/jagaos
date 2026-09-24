import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { PRODUCT_NAME } from '../config/product'
import { FOOTER_TAGLINE } from '../config/site'
import { Footer } from './Footer'

afterEach(cleanup)

describe('Footer', () => {
  it('is the logo, the tagline and the copyright, and nothing else', () => {
    const { container } = render(<Footer />)
    expect(screen.getByText(FOOTER_TAGLINE)).toBeTruthy()
    expect(screen.getByText(new RegExp(`© ${new Date().getFullYear()} ${PRODUCT_NAME}`))).toBeTruthy()
    expect(container.querySelectorAll('nav')).toHaveLength(0)
    expect(container.querySelectorAll('svg')).toHaveLength(0) // no social icons
    // the only link is the logo, which goes home
    expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/'])
  })

  it('carries none of the old columns or social links', () => {
    render(<Footer />)
    for (const word of ['Solutions', 'Resources', 'Documentation', 'Founders', 'LinkedIn', 'Privacy', 'Terms']) {
      expect(screen.queryByText(word)).toBeNull()
    }
  })
})
