import { describe, expect, it } from 'vitest'
import { firstOfMonth, shiftYearPage, yearPageStart, yearsOfPage, YEARS_PER_PAGE } from './monthPaging'

describe('year pages', () => {
  it('a page holds 24 consecutive years and contains the year it was built around', () => {
    const years = yearsOfPage(yearPageStart(2026))
    expect(years).toHaveLength(YEARS_PER_PAGE)
    expect(years).toContain(2026)
    expect(years.every((y, i) => i === 0 || y === years[i - 1]! + 1)).toBe(true)
  })

  it('reaches both a distant past and a near future year without paging', () => {
    const years = yearsOfPage(yearPageStart(2026))
    expect(years[0]).toBe(2009)
    expect(years.at(-1)).toBe(2032)
  })

  it('paging moves by a whole page and back again', () => {
    const start = yearPageStart(2026)
    expect(shiftYearPage(start, -1)).toBe(start - YEARS_PER_PAGE)
    expect(shiftYearPage(shiftYearPage(start, 1), -1)).toBe(start)
    expect(yearsOfPage(shiftYearPage(start, -1))).toContain(1990)
  })
})

describe('firstOfMonth', () => {
  it('is the first day of the chosen month, zero-padded', () => {
    expect(firstOfMonth(2019, 2)).toBe('2019-03-01')
    expect(firstOfMonth(2031, 11)).toBe('2031-12-01')
    expect(firstOfMonth(2026, 0)).toBe('2026-01-01')
  })
})
