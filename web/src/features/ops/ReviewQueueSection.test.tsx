/** The review queue section (DECISIONS #109): the cards when something waits, a legible empty state when nothing does. */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

vi.mock('./ReviewQueueCard', () => ({ ReviewQueueCard: ({ item }: { item: { id: number } }) => <div data-testid="review-card">card {item.id}</div> }))

import type { ReviewItem } from './opsApi'
import { ReviewQueueSection } from './ReviewQueueSection'

const item = (id: number): ReviewItem => ({
  id, document_id: id, document_filename: `f${id}.pdf`, document_media_type: 'application/pdf', document_description: null,
  document_bucket: null, document_lane: 'invoice', document_doc_type: 'invoice', document_vendor_name: null,
  thread_id: `t${id}`, reason: 'clean', question: '[]', proposed_json: '{}', status: 'open',
})
const show = (over: Partial<Parameters<typeof ReviewQueueSection>[0]> = {}) =>
  render(<ReviewQueueSection items={[]} loaded failed={false} canResolve onResolved={vi.fn()} onRejected={vi.fn()} onPoll={vi.fn()} {...over} />)

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

describe('ReviewQueueSection', () => {
  it('with nothing waiting it says so and explains the step, so the feature is legible', () => {
    show()
    const section = screen.getByTestId('review-empty')
    expect(section.querySelector('h2')!.textContent).toBe('Needs review (0)')
    expect(screen.getByText('Nothing waiting for review')).toBeTruthy()
    expect(screen.getByText('A document you upload waits here until someone confirms what was read from it.')).toBeTruthy()
    expect(screen.queryAllByTestId('review-card')).toHaveLength(0)
  })

  it('with items it shows the amber heading and one card each, and no empty state', () => {
    show({ items: [item(1), item(2)] })
    expect(screen.getByRole('heading', { name: 'Needs review (2)' })).toBeTruthy()
    expect(screen.getAllByTestId('review-card')).toHaveLength(2)
    expect(screen.queryByTestId('review-empty')).toBeNull()
  })

  it('shows NOTHING before the first load has finished: an empty list then means "not loaded yet", not "nothing waiting"', () => {
    const { container } = show({ loaded: false })
    expect(container.firstChild).toBeNull()
  })

  it('shows nothing on top of a load error, which the page reports itself', () => {
    const { container } = show({ failed: true })
    expect(container.firstChild).toBeNull()
  })

  it.each([
    ['zh', '没有待审核的内容'],
    ['ms', 'Tiada apa-apa menunggu semakan'],
    ['ta', 'மதிப்பாய்வுக்குக் காத்திருப்பது எதுவும் இல்லை'],
  ])('reads in %s', async (language, text) => {
    await i18n.changeLanguage(language)
    show()
    expect(screen.getByText(text)).toBeTruthy()
  })
})
