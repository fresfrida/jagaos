import { describe, expect, it } from 'vitest'
import { MAX_PX, MIN_PX, sizeTerms } from './cloudSizing'

const t = (term: string, count: number) => ({ term, count })

describe('sizeTerms', () => {
  it('gives the most common word the largest size and the least common the smallest, and the rest between', () => {
    const sized = sizeTerms([t('rare', 1), t('mid', 5), t('common', 9)])
    const px = Object.fromEntries(sized.map((s) => [s.term, s.px]))
    expect(px.rare).toBe(MIN_PX)
    expect(px.common).toBe(MAX_PX)
    expect(px.mid).toBeGreaterThan(MIN_PX)
    expect(px.mid).toBeLessThan(MAX_PX)
    expect(px.mid).toBe(Math.round((MIN_PX + MAX_PX) / 2))
  })

  it('draws words that share a count at one size, whatever that count is', () => {
    const sized = sizeTerms([t('a', 3), t('b', 3), t('c', 3)])
    expect(new Set(sized.map((s) => s.px)).size).toBe(1)
    expect(sized[0]!.px).toBeGreaterThanOrEqual(MIN_PX)
    expect(sized[0]!.px).toBeLessThanOrEqual(MAX_PX)
  })

  it('orders the words alphabetically without regard to case, so it reads as a cloud and not a ranking', () => {
    expect(sizeTerms([t('zebra', 1), t('Apple', 9), t('mango', 5)]).map((s) => s.term)).toEqual(['Apple', 'mango', 'zebra'])
  })

  it('is the same every time, and does not change what it is given', () => {
    const input = [t('b', 2), t('a', 7)]
    const copy = JSON.parse(JSON.stringify(input))
    expect(sizeTerms(input)).toEqual(sizeTerms(input))
    expect(input).toEqual(copy)
  })

  it('has nothing to size when there are no words', () => {
    expect(sizeTerms([])).toEqual([])
  })

  it('never goes below a legible size', () => {
    expect(MIN_PX).toBeGreaterThanOrEqual(14)
  })
})
