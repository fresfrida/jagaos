/** The Calendar keeps its view across leaving the page (DECISIONS #105): month, tapped day and date basis in the URL, with the
 * tab's last view as the fallback for the bare `/calendar` the nav item links to. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ company: { timezone: 'Asia/Singapore' } }) }))

import type { DocumentRow } from '../ops/opsApi'
import { calendarViewFromQuery, calendarViewToQuery, readCalendarView, type CalendarView } from './calendarView'
import { DatesView } from './DatesView'

const DEFAULTS: CalendarView = { basis: 'upload', month: '2026-09-01', selectedDay: null }

describe('calendarViewToQuery / calendarViewFromQuery', () => {
  it('round-trips a full view, and writes the basis only when it is not the default', () => {
    const view: CalendarView = { basis: 'document', month: '2020-03-01', selectedDay: '2020-03-05' }
    expect(calendarViewToQuery(view)).toBe('m=2020-03&d=2020-03-05&basis=document')
    expect(calendarViewFromQuery(calendarViewToQuery(view), DEFAULTS)).toEqual(view)
    expect(calendarViewToQuery({ basis: 'upload', month: '2020-03-01', selectedDay: null })).toBe('m=2020-03')
  })

  it('is null when the query carries none of the three, so the caller can look elsewhere', () => {
    expect(calendarViewFromQuery('', DEFAULTS)).toBeNull()
    expect(calendarViewFromQuery('?bucket=Expenses', DEFAULTS)).toBeNull()
  })

  it('takes each field on its own merits: a bad one falls back, it does not smuggle anything in', () => {
    expect(calendarViewFromQuery('m=2020-13&d=not-a-day&basis=evil', DEFAULTS)).toEqual(DEFAULTS)
    expect(calendarViewFromQuery('m=2020-03', DEFAULTS)).toEqual({ basis: 'upload', month: '2020-03-01', selectedDay: null })
  })

  it('a day alone also places the month', () => {
    expect(calendarViewFromQuery('d=2019-11-20', DEFAULTS)).toEqual({ basis: 'upload', month: '2019-11-01', selectedDay: '2019-11-20' })
  })
})

describe('readCalendarView', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/calendar')
  })

  it('reads the tab\'s last view when the URL has none, and the URL wins when it has one', () => {
    window.sessionStorage.setItem('jaga.calendar.view', 'm=2018-06&d=2018-06-02')
    expect(readCalendarView(DEFAULTS)).toEqual({ basis: 'upload', month: '2018-06-01', selectedDay: '2018-06-02' })

    window.history.replaceState(null, '', '/calendar?m=2020-03')
    expect(readCalendarView(DEFAULTS).month).toBe('2020-03-01')
  })

  it('opens on the defaults when nothing was kept, and survives storage that throws', () => {
    expect(readCalendarView(DEFAULTS)).toEqual(DEFAULTS)
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readCalendarView(DEFAULTS)).toEqual(DEFAULTS)
    blocked.mockRestore()
  })
})

const doc = (over: Partial<DocumentRow> = {}): DocumentRow => ({
  id: 1, filename: 'invoice-2020.pdf', media_type: 'application/pdf', lane: 'invoice', doc_type: 'invoice',
  status: 'filed', received_at: '2020-03-05 03:00:00', description: JSON.stringify({ en: 'March 2020 invoice' }), bucket: 'Expenses',
  vendor_name: null, occurred_on: '2020-03-05', ...over,
})

const todaySg = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const cell = (dayOfMonth: number) => {
  const found = screen.getAllByRole('button').find((b) => b.hasAttribute('aria-pressed') && b.firstElementChild?.textContent === String(dayOfMonth) && b.className.includes('min-h'))
  if (!found) throw new Error(`no day cell ${dayOfMonth}`)
  return found
}
/** The three-tap route to March 2020 that a person would take: header, year, month. */
const browseToMarch2020 = () => {
  fireEvent.click(screen.getByRole('button', { name: /choose a year and month/i }))
  fireEvent.click(within(screen.getByTestId('year-grid')).getByRole('button', { name: '2020' }))
  fireEvent.click(within(screen.getByTestId('month-grid')).getAllByRole('button')[2]!)
}

describe('DatesView keeps its view (DECISIONS #105)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/calendar')
  })
  afterEach(cleanup)

  it('opening the Calendar writes nothing: no URL params, nothing stored', () => {
    render(<DatesView documents={[doc()]} />)
    expect(window.location.search).toBe('')
    expect(window.sessionStorage.getItem('jaga.calendar.view')).toBeNull()
  })

  it('a change lands in the URL by REPLACING the history entry, so it adds no Back step', () => {
    const before = window.history.length
    render(<DatesView documents={[doc()]} />)
    browseToMarch2020()
    fireEvent.click(cell(5))

    expect(window.location.pathname + window.location.search).toBe('/calendar?m=2020-03&d=2020-03-05')
    expect(window.history.length).toBe(before)
    expect(window.sessionStorage.getItem('jaga.calendar.view')).toBe('m=2020-03&d=2020-03-05')
  })

  it('browse to 2020, open a file in Company Files, Back: the Calendar is exactly where it was left', async () => {
    const { unmount } = render(<DatesView documents={[doc()]} />)
    browseToMarch2020()
    fireEvent.click(cell(5))
    fireEvent.click(screen.getByRole('link', { name: /March 2020 invoice/ })) // the router pushes /company-files?doc=1
    expect(window.location.pathname + window.location.search).toBe('/company-files?doc=1')
    unmount() // the page changed, so the Calendar is gone

    window.history.back()
    await waitFor(() => expect(window.location.pathname).toBe('/calendar'))
    render(<DatesView documents={[doc()]} />)

    expect(screen.getByRole('button', { name: /march 2020/i })).toBeTruthy() // the month
    expect(cell(5).getAttribute('aria-pressed')).toBe('true') // the tapped day, kept
    expect(screen.getByRole('link', { name: /March 2020 invoice/ })).toBeTruthy() // and its list, not the "tap a day" prompt
  })

  it('the nav item (a bare /calendar) restores the tab\'s last view instead of today', () => {
    const first = render(<DatesView documents={[doc()]} />)
    browseToMarch2020()
    first.unmount()

    window.history.replaceState(null, '', '/calendar') // what clicking "Calendar" gives: no params
    render(<DatesView documents={[doc()]} />)
    expect(screen.getByRole('button', { name: /march 2020/i })).toBeTruthy()
  })

  it('a restored day survives mounting, and switching the basis clears it (an effect would have wiped it on mount)', () => {
    window.history.replaceState(null, '', '/calendar?m=2020-03&d=2020-03-05')
    render(<DatesView documents={[doc()]} />)
    expect(screen.getByRole('link', { name: /March 2020 invoice/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Document dates' }))
    expect(screen.queryByRole('link', { name: /March 2020 invoice/ })).toBeNull()
    expect(window.location.search).toBe('?m=2020-03&basis=document')
  })

  it('Today jumps from a far year back to the current month, selects today, and is remembered', () => {
    render(<DatesView documents={[doc()]} />)
    browseToMarch2020()
    expect(screen.queryByRole('button', { name: new RegExp(todaySg.slice(0, 4)) })).toBeNull() // not on the current year

    fireEvent.click(screen.getByRole('button', { name: 'Today' }))

    const monthName = new Date(`${todaySg.slice(0, 7)}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    expect(screen.getByRole('button', { name: new RegExp(monthName, 'i') })).toBeTruthy()
    expect(cell(Number(todaySg.slice(8))).getAttribute('aria-pressed')).toBe('true')
    expect(window.location.search).toBe(`?m=${todaySg.slice(0, 7)}&d=${todaySg}`)
  })
})

describe('DatesView leaves out a rejected document (DECISIONS #109)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    window.sessionStorage.clear()
    window.history.replaceState(null, '', '/calendar?m=2020-03&d=2020-03-05')
  })
  afterEach(cleanup)

  it('it is neither listed under its day nor counted in the grid, while an ordinary document on the same day is both', () => {
    render(<DatesView documents={[doc({ id: 1 }), doc({ id: 2, status: 'rejected', filename: 'legacy-rejected.pdf', description: null })]} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.queryByText(/legacy-rejected/)).toBeNull()
    expect(cell(5).textContent).toBe('51') // the day number, then a count badge of 1: the rejected one is not in it
  })

  it('a day with only a rejected document looks empty, and the "no documents" hint appears when that is all there is', () => {
    render(<DatesView documents={[doc({ id: 2, status: 'rejected' })]} />)
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByTestId('no-documents-hint')).toBeTruthy()
  })
})

