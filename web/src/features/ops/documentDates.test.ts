/** Which day a document falls on, and a from/to range over those days (round 21, A1 and A7, DECISIONS #101). */

import { describe, expect, it } from 'vitest'
import {
  rangeEcho,
  documentDay, filterByDateRange, NO_RANGE, parseBasis, parseDay, rangeFromParams, rangeIsBackwards, rangeIsSet, rangeToParams,
} from './documentDates'

const doc = (received_at: string, occurred_on: string | null = null) => ({ received_at, occurred_on })

describe('parseDay / parseBasis', () => {
  it('keeps a real YYYY-MM-DD and drops anything else, so a hand-edited link cannot smuggle text into a filter', () => {
    expect(parseDay('2026-09-25')).toBe('2026-09-25')
    for (const bad of ['', null, undefined, '2026-9-5', '25/09/2026', '2026-13-40', '2026-02-30x', '<script>', '2026-09-25T00:00:00']) {
      expect(parseDay(bad as string | null | undefined), String(bad)).toBe('')
    }
  })

  it('reads the basis, defaulting to the upload date for anything unknown', () => {
    expect(parseBasis('document')).toBe('document')
    for (const other of ['upload', '', null, undefined, 'filed', 'DOCUMENT']) expect(parseBasis(other as string | null | undefined)).toBe('upload')
  })
})

describe('documentDay', () => {
  it('reads the upload timestamp in the COMPANY timezone: a file uploaded late in the UTC day is the next day in Singapore', () => {
    expect(documentDay(doc('2026-09-24 20:30:00'), 'upload', 'Asia/Singapore')).toBe('2026-09-25')
    expect(documentDay(doc('2026-09-24 20:30:00'), 'upload', 'UTC')).toBe('2026-09-24')
  })

  it('reads the document\'s own date as the bare date it is, whatever the timezone, or null when it has none', () => {
    expect(documentDay(doc('2026-09-24 20:30:00', '2026-01-31'), 'document', 'Asia/Singapore')).toBe('2026-01-31')
    expect(documentDay(doc('2026-09-24 20:30:00', '2026-01-31T13:00:00'), 'document', 'Pacific/Auckland')).toBe('2026-01-31')
    expect(documentDay(doc('2026-09-24 20:30:00', null), 'document', 'Asia/Singapore')).toBeNull()
  })
})

describe('the range', () => {
  it('is set when either end is given, and backwards only when both are and the start is after the end', () => {
    expect(rangeIsSet(NO_RANGE)).toBe(false)
    expect(rangeIsSet({ from: '2026-01-01', to: '' })).toBe(true)
    expect(rangeIsSet({ from: '', to: '2026-01-01' })).toBe(true)
    expect(rangeIsBackwards({ from: '2026-02-01', to: '2026-01-01' })).toBe(true)
    expect(rangeIsBackwards({ from: '2026-01-01', to: '2026-01-01' })).toBe(false)
    expect(rangeIsBackwards({ from: '2026-02-01', to: '' })).toBe(false)
  })
})

describe('filterByDateRange', () => {
  const docs = [
    { id: 1, ...doc('2026-01-10 03:00:00', '2025-12-31') },
    { id: 2, ...doc('2026-02-15 03:00:00', '2026-02-01') },
    { id: 3, ...doc('2026-03-20 03:00:00', null) },
    { id: 4, ...doc('2026-04-05 03:00:00', '2026-04-05') },
  ]
  const ids = (found: { id: number }[]) => found.map((d) => d.id)

  it('keeps everything, dated or not, when no range is set', () => {
    expect(ids(filterByDateRange(docs, 'document', NO_RANGE, 'Asia/Singapore'))).toEqual([1, 2, 3, 4])
  })

  it('is inclusive at both ends, on the upload date', () => {
    expect(ids(filterByDateRange(docs, 'upload', { from: '2026-02-15', to: '2026-03-20' }, 'Asia/Singapore'))).toEqual([2, 3])
    expect(ids(filterByDateRange(docs, 'upload', { from: '2026-02-16', to: '2026-03-19' }, 'Asia/Singapore'))).toEqual([])
  })

  it('an open end means "from then on" or "up to then"', () => {
    expect(ids(filterByDateRange(docs, 'upload', { from: '2026-03-01', to: '' }, 'Asia/Singapore'))).toEqual([3, 4])
    expect(ids(filterByDateRange(docs, 'upload', { from: '', to: '2026-02-28' }, 'Asia/Singapore'))).toEqual([1, 2])
  })

  it('on the document date, a document with no date of its own cannot be placed in a range and is left out', () => {
    expect(ids(filterByDateRange(docs, 'document', { from: '2026-01-01', to: '2026-12-31' }, 'Asia/Singapore'))).toEqual([2, 4])
  })

  it('the same range gives different answers on the two bases', () => {
    const range = { from: '2025-12-01', to: '2026-01-05' }
    expect(ids(filterByDateRange(docs, 'document', range, 'Asia/Singapore'))).toEqual([1])
    expect(ids(filterByDateRange(docs, 'upload', range, 'Asia/Singapore'))).toEqual([])
  })

  it('a backwards range keeps nothing', () => {
    expect(filterByDateRange(docs, 'upload', { from: '2026-12-01', to: '2026-01-01' }, 'Asia/Singapore')).toEqual([])
  })

  it('does not change the list it is given', () => {
    const copy = [...docs]
    filterByDateRange(docs, 'upload', { from: '2026-03-01', to: '' }, 'Asia/Singapore')
    expect(docs).toEqual(copy)
  })
})

describe('the range as URL parameters', () => {
  it('writes nothing for no range, and the ends and basis for a set one', () => {
    expect(rangeToParams('upload', NO_RANGE)).toEqual({})
    expect(rangeToParams('document', { from: '2026-01-01', to: '' })).toEqual({ from: '2026-01-01', basis: 'document' })
    expect(rangeToParams('upload', { from: '2026-01-01', to: '2026-02-01' })).toEqual({ from: '2026-01-01', to: '2026-02-01', basis: 'upload' })
  })

  it('reads them back, and ignores junk', () => {
    const range = { from: '2026-01-01', to: '2026-02-01' }
    expect(rangeFromParams(new URLSearchParams(rangeToParams('document', range)))).toEqual({ basis: 'document', range })
    expect(rangeFromParams(new URLSearchParams('from=yesterday&to=%3Cb%3E&basis=filed'))).toEqual({ basis: 'upload', range: NO_RANGE })
    expect(rangeFromParams(new URLSearchParams(''))).toEqual({ basis: 'upload', range: NO_RANGE })
  })
})

describe('rangeEcho (DECISIONS #110)', () => {
  it('names which sentence to say, and the ISO days to put in it', () => {
    expect(rangeEcho({ from: '2024-01-01', to: '2024-03-31' })).toEqual({ key: 'echoBoth', from: '2024-01-01', to: '2024-03-31' })
    expect(rangeEcho({ from: '2024-01-01', to: '' })).toEqual({ key: 'echoFrom', from: '2024-01-01', to: '' })
    expect(rangeEcho({ from: '', to: '2024-03-31' })).toEqual({ key: 'echoTo', from: '', to: '2024-03-31' })
  })

  it('is null when there is nothing to say: no range, or a backwards one', () => {
    expect(rangeEcho({ from: '', to: '' })).toBeNull()
    expect(rangeEcho({ from: '2024-05-01', to: '2024-01-01' })).toBeNull()
  })

  it('a one-day range (the same day at both ends) is a range, not backwards', () => {
    expect(rangeEcho({ from: '2024-03-05', to: '2024-03-05' })).toEqual({ key: 'echoBoth', from: '2024-03-05', to: '2024-03-05' })
  })
})


// ---------------------------------------------------------------- round 7, S1e (DECISIONS #138): a picture's date

import { displayDates, isPicture, uploadDay } from './documentDates'

const pic = (received_at: string, occurred_on: string | null = null) => ({ received_at, occurred_on, lane: 'memory' })
const invoice = (received_at: string, occurred_on: string | null = null) => ({ received_at, occurred_on, lane: 'invoice' })

describe('a picture (lane memory) with no date-taken', () => {
  it('falls back to its UPLOAD day, in the company timezone, under the document basis', () => {
    expect(documentDay(pic('2026-09-24 20:30:00'), 'document', 'Asia/Singapore')).toBe('2026-09-25')   // 20:30 UTC is the next day in Singapore
    expect(documentDay(pic('2026-09-24 20:30:00'), 'document', 'UTC')).toBe('2026-09-24')
  })

  it('a picture WITH a date-taken uses it, whatever day it was uploaded', () => {
    expect(documentDay(pic('2026-09-24 20:30:00', '2019-08-08'), 'document', 'Asia/Singapore')).toBe('2019-08-08')
  })

  it('the upload basis is unchanged for a picture', () => {
    expect(documentDay(pic('2026-09-24 20:30:00', '2019-08-08'), 'upload', 'Asia/Singapore')).toBe('2026-09-25')
  })

  it('every OTHER document with no date still has no document day (the fallback is for pictures only)', () => {
    for (const lane of ['invoice', 'statutory', 'important', null, undefined]) {
      expect(documentDay({ received_at: '2026-09-24 20:30:00', occurred_on: null, lane }, 'document', 'Asia/Singapore'), String(lane)).toBeNull()
    }
    expect(documentDay({ received_at: '2026-09-24 20:30:00', occurred_on: null }, 'document', 'Asia/Singapore')).toBeNull()   // a caller with no lane at all
  })

  it('the range filter agrees: the picture is inside a document-date range that holds its upload day, and a non-picture with no date is not', () => {
    const docs = [pic('2026-09-24 05:00:00'), invoice('2026-09-24 05:00:00'), pic('2026-09-24 05:00:00', '2019-08-08')]
    const range = { from: '2026-09-24', to: '2026-09-24' }
    expect(filterByDateRange(docs, 'document', range, 'Asia/Singapore')).toEqual([docs[0]])
    expect(filterByDateRange(docs, 'document', { from: '2019-08-01', to: '2019-08-31' }, 'Asia/Singapore')).toEqual([docs[2]])
    expect(filterByDateRange(docs, 'upload', range, 'Asia/Singapore')).toEqual(docs)
  })

  it('an unset range still keeps every document, dated or not', () => {
    const docs = [pic('2026-09-24 05:00:00'), invoice('2026-09-24 05:00:00')]
    expect(filterByDateRange(docs, 'document', NO_RANGE, 'Asia/Singapore')).toEqual(docs)
  })
})

describe('isPicture, uploadDay and displayDates: the one rule the card, the Calendar and the filter share', () => {
  it('a picture is exactly lane memory', () => {
    expect(isPicture({ lane: 'memory' })).toBe(true)
    for (const lane of ['invoice', 'statutory', 'important', '', null, undefined]) expect(isPicture({ lane }), String(lane)).toBe(false)
  })

  it('uploadDay is the upload timestamp in the company timezone, or null with no timestamp', () => {
    expect(uploadDay({ received_at: '2026-09-24 20:30:00' }, 'Asia/Singapore')).toBe('2026-09-25')
    expect(uploadDay({ received_at: '' }, 'Asia/Singapore')).toBeNull()
  })

  it('a picture with a date-taken: both days, its own, and not the fallback', () => {
    expect(displayDates(pic('2026-09-24 20:30:00', '2019-08-08'), 'Asia/Singapore')).toEqual({ upload: '2026-09-25', document: '2019-08-08', picture: true, fromUpload: false })
  })

  it('a picture without one: the document day IS the upload day, and it says so', () => {
    expect(displayDates(pic('2026-09-24 20:30:00'), 'Asia/Singapore')).toEqual({ upload: '2026-09-25', document: '2026-09-25', picture: true, fromUpload: true })
  })

  it('a non-picture is unchanged: its own date, or none', () => {
    expect(displayDates(invoice('2026-09-24 20:30:00', '2026-09-01'), 'Asia/Singapore')).toEqual({ upload: '2026-09-25', document: '2026-09-01', picture: false, fromUpload: false })
    expect(displayDates(invoice('2026-09-24 20:30:00'), 'Asia/Singapore')).toEqual({ upload: '2026-09-25', document: null, picture: false, fromUpload: false })
  })
})
