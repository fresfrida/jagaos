/** The Calendar is the documents-by-date section and nothing else (DECISIONS #108): the obligations list and the compliance
 * checklist summary came off it, whatever the API still returns. */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ company: { timezone: 'Asia/Singapore' }, role: 'owner' }) }))
const ops = vi.hoisted(() => ({
  value: {
    documents: [] as unknown[],
    expectations: [{ id: 1, doc_type: 'certificate_of_incorporation', label: 'Certificate of Incorporation', status: 'satisfied' }] as unknown[],
    obligations: [{ id: 1, kind: 'annual_return', label: 'File Annual Return', due_on: '2026-07-31', status: 'open', risk: 'high', citation: 'Companies Act s197' }] as unknown[],
    apiUp: true, error: null as string | null,
  },
}))
vi.mock('../ops/useOpsData', () => ({ useOpsData: () => ops.value }))

import { CalendarHub } from './CalendarHub'

beforeEach(async () => {
  await i18n.changeLanguage('en')
  window.sessionStorage.clear()
  window.history.replaceState(null, '', '/calendar')
  ops.value.error = null
})
afterEach(cleanup)

describe('CalendarHub', () => {
  it('has the Dates section: the toggle and the month grid', () => {
    render(<CalendarHub />)
    expect(screen.getByRole('heading', { name: 'Dates' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Uploaded dates' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Document dates' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /choose a year and month/i })).toBeTruthy()
  })

  it('shows NO obligations section even when the API returns obligations', () => {
    render(<CalendarHub />)
    expect(screen.queryByText('File Annual Return')).toBeNull()
    expect(screen.queryByText(/obligations/i)).toBeNull()
    expect(screen.queryByText(/nothing due yet/i)).toBeNull()
  })

  it('shows NO compliance-checklist summary, even with a satisfied checklist item', () => {
    render(<CalendarHub />)
    expect(screen.queryByText(/held/i)).toBeNull()
    expect(screen.queryByText(/checklist/i)).toBeNull()
  })

  it('has exactly one section', () => {
    const { container } = render(<CalendarHub />)
    expect(container.querySelectorAll('section')).toHaveLength(1)
  })

  it('still shows a load error, visibly', () => {
    ops.value.error = 'Could not load documents'
    render(<CalendarHub />)
    expect(screen.getByRole('alert').textContent).toBe('Could not load documents')
  })
})
