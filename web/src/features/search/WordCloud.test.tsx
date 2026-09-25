import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { WordCloud } from './WordCloud'
import type { SearchTermsState } from './useSearchTerms'

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

const show = (state: SearchTermsState) => {
  const onPick = vi.fn()
  const onRetry = vi.fn()
  const view = render(<WordCloud state={state} onRetry={onRetry} onPick={onPick} />)
  return { ...view, onPick, onRetry }
}
const ready = (terms: { term: string; count: number }[]): SearchTermsState => ({ status: 'ready', terms })

describe('WordCloud', () => {
  it('shows each word as a button, bigger where more documents contain it, with the count for a screen reader', () => {
    show(ready([{ term: 'lease', count: 9 }, { term: 'stationery', count: 1 }]))
    const lease = screen.getByRole('button', { name: 'lease (9)' })
    const stationery = screen.getByRole('button', { name: 'stationery (1)' })
    expect(parseInt(lease.style.fontSize)).toBeGreaterThan(parseInt(stationery.style.fontSize))
    expect(screen.getByRole('heading', { name: 'What your documents talk about' })).toBeTruthy()
    expect(screen.getByText('Tap a word to search for it.')).toBeTruthy()
  })

  it('tapping a word reports it, which is what runs that search', () => {
    const { onPick } = show(ready([{ term: 'lease', count: 3 }, { term: 'office', count: 2 }]))
    fireEvent.click(screen.getByRole('button', { name: 'office (2)' }))
    expect(onPick).toHaveBeenCalledWith('office')
  })

  it('lists the words alphabetically', () => {
    show(ready([{ term: 'zebra', count: 5 }, { term: 'apple', count: 1 }, { term: 'mango', count: 3 }]))
    const words = within(screen.getByRole('list')).getAllByRole('button').map((b) => b.textContent!.replace(/\s*\(\d+\)$/, ''))
    expect(words).toEqual(['apple', 'mango', 'zebra'])
  })

  it('draws nothing when there are no words, or the backend has no cloud', () => {
    const empty = show(ready([]))
    expect(empty.container.textContent).toBe('')
    cleanup()
    const missing = show({ status: 'unavailable' })
    expect(missing.container.textContent).toBe('')
  })

  it('says it is loading, and says when it failed and lets the person try again', () => {
    show({ status: 'loading' })
    expect(screen.getByRole('status').textContent).toBe('Loading the word cloud…')
    cleanup()
    const { onRetry } = show({ status: 'failed' })
    expect(screen.getByText('The word cloud could not be loaded.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalled()
  })
})
