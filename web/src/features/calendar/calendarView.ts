/** What the Calendar's Dates section is showing (2026-09-25, DECISIONS #105): the month, the tapped day and the date basis.
 * It lives in the URL (`/calendar?m=2020-03&d=2020-03-05&basis=document`), because the URL is what the browser's Back button
 * returns to: a day-list row now leaves the page for Company Files, and Back must land on the same view. It is also kept in
 * sessionStorage, because the Calendar nav item is a bare `/calendar` with nothing to read; that fallback is read only when
 * the URL carries none of the three. A change REPLACES the history entry (a click on next-month must not need many Backs to
 * leave the page) and is written from the event handler, so merely opening the Calendar writes nothing.
 * The month picker's open/closed state is not kept: coming back always shows the day grid. */

import { useState } from 'react'
import { parseBasis, parseDay, type DateBasis } from '../ops/documentDates'

export interface CalendarView {
  basis: DateBasis
  /** The first day of the displayed month, `YYYY-MM-01`. */
  month: string
  selectedDay: string | null
}

const STORAGE_KEY = 'jaga.calendar.view'
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** `YYYY-MM-01` if `raw` is a `YYYY-MM` month, else null: a hand-edited link cannot smuggle anything else into the grid. */
function parseMonth(raw: string | null): string | null {
  return raw !== null && MONTH.test(raw) ? `${raw}-01` : null
}

/** The view as a query string. The basis is written only when it is not the default, so the common URL stays short. */
export function calendarViewToQuery(view: CalendarView): string {
  const params = new URLSearchParams({ m: view.month.slice(0, 7) })
  if (view.selectedDay) params.set('d', view.selectedDay)
  if (view.basis !== 'upload') params.set('basis', view.basis)
  return params.toString()
}

/** The view a query string describes, each field falling back to `defaults` when it is missing or invalid; null when the
 * query carries none of the three (so the caller can look elsewhere). A day alone also places the month. */
export function calendarViewFromQuery(query: string, defaults: CalendarView): CalendarView | null {
  const params = new URLSearchParams(query)
  if (!params.has('m') && !params.has('d') && !params.has('basis')) return null
  const day = parseDay(params.get('d')) || null
  return {
    basis: parseBasis(params.get('basis')),
    month: parseMonth(params.get('m')) ?? (day ? `${day.slice(0, 7)}-01` : defaults.month),
    selectedDay: day,
  }
}

function storedQuery(): string {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return '' // storage blocked or unavailable: the Calendar just opens on today
  }
}

/** The URL wins (Back, a shared link); else what the tab last showed; else `defaults`. */
export function readCalendarView(defaults: CalendarView): CalendarView {
  return calendarViewFromQuery(window.location.search, defaults) ?? calendarViewFromQuery(storedQuery(), defaults) ?? defaults
}

function persistCalendarView(view: CalendarView): void {
  const query = calendarViewToQuery(view)
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${query}`)
  try {
    window.sessionStorage.setItem(STORAGE_KEY, query)
  } catch {
    // storage blocked: the URL alone still carries the view for Back
  }
}

/** The Calendar's view state; `update` changes some of it and records the result in the URL and the tab. */
export function useCalendarView(defaults: CalendarView): { view: CalendarView; update: (patch: Partial<CalendarView>) => void } {
  const [view, setView] = useState(() => readCalendarView(defaults))
  const update = (patch: Partial<CalendarView>) => {
    const next = { ...view, ...patch }
    setView(next)
    persistCalendarView(next)
  }
  return { view, update }
}
