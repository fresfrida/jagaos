/** The Tags page (round 21, A7, DECISIONS #101): a bucket button per tag, each a link into Company Files, and a from/to date
 * range chosen here rides along on those links. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { BUCKETS } from '../ops/opsApi'
import { TagsLanding } from './TagsLanding'

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

const hrefOf = (label: RegExp | string) => new URL(screen.getByRole('link', { name: label }).getAttribute('href')!, 'http://x')

describe('TagsLanding', () => {
  it('links every bucket to Company Files filtered to it, with no dates when none are chosen', () => {
    render(<TagsLanding />)
    expect(screen.getAllByRole('link')).toHaveLength(BUCKETS.length)
    const url = hrefOf('Expenses')
    expect(url.pathname).toBe('/company-files')
    expect([...url.searchParams.keys()]).toEqual(['bucket'])
    expect(url.searchParams.get('bucket')).toBe('Expenses')
  })

  it('carries the chosen range and basis on every link', () => {
    render(<TagsLanding />)
    fireEvent.click(screen.getByRole('button', { name: 'Document dates' }))
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-31' } })

    for (const bucket of BUCKETS) {
      const url = hrefOf(new RegExp(bucket, 'i'))
      expect(url.searchParams.get('bucket')).toBe(bucket)
      expect(url.searchParams.get('from')).toBe('2026-01-01')
      expect(url.searchParams.get('to')).toBe('2026-03-31')
      expect(url.searchParams.get('basis')).toBe('document')
    }
  })

  it('an open end is left out, and clearing the dates takes them off the links again', () => {
    render(<TagsLanding />)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-05-01' } })
    const open = hrefOf('Expenses')
    expect(open.searchParams.get('from')).toBe('2026-05-01')
    expect(open.searchParams.has('to')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Clear dates' }))
    expect([...hrefOf('Expenses').searchParams.keys()]).toEqual(['bucket'])
  })
})
