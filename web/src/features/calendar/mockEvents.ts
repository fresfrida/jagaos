import type { CalendarEvent } from './types'

/** The demo's fixed "today" (a Monday) and the week it opens on. */
export const MOCK_TODAY = '2026-09-21'
export const INITIAL_WEEK_START = '2026-09-21'

export const EVENTS: CalendarEvent[] = [
  {
    id: 'e-supplier-review',
    title: 'Supplier review',
    date: '2026-09-22',
    start: '10:00',
    end: '11:00',
    people: [
      { name: 'Priya Nair', role: 'Operations lead' },
      { name: 'Marcus Lee', role: 'Northwind Packaging' },
    ],
    relatedMemoryIds: ['m-supplier-review', 'm-northwind-invoice'],
  },
  {
    id: 'e-ops-handover',
    title: 'Operations handover',
    date: '2026-09-23',
    start: '14:00',
    end: '15:30',
    people: [
      { name: 'Daniel Ortiz', role: 'Warehouse manager' },
      { name: 'Priya Nair', role: 'Operations lead' },
    ],
    relatedMemoryIds: ['m-warehouse-handover', 'm-harbour-dispute'],
  },
  {
    id: 'e-client-renewal',
    title: 'Client renewal',
    date: '2026-09-24',
    start: '11:00',
    end: '12:00',
    people: [
      { name: 'Sofia Alvarez', role: 'Customer success' },
      { name: 'Jordan Blake', role: 'Acme' },
    ],
    relatedMemoryIds: ['m-acme-renewal', 'm-acme-billing'],
  },
  {
    id: 'e-payroll-cutoff',
    title: 'Payroll cut-off',
    date: '2026-09-25',
    start: '16:00',
    end: '17:00',
    people: [{ name: 'Hannah Cole', role: 'Finance lead' }],
    relatedMemoryIds: ['m-payroll-cutoff'],
  },
  {
    id: 'e-monthly-close',
    title: 'Monthly close',
    date: '2026-09-30',
    start: '09:30',
    end: '12:00',
    people: [
      { name: 'Hannah Cole', role: 'Finance lead' },
      { name: 'Sofia Alvarez', role: 'Customer success' },
    ],
    relatedMemoryIds: ['m-monthly-close', 'm-northwind-invoice'],
  },
]
