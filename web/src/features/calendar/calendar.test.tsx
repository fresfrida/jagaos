/** Round 16, items 7 to 10a: the Calendar page's pieces. jsdom has no layout, so
 * these pin behaviour and structure (what is rendered, what a tap does); the
 * measured widths and clipping are checked in a real browser with screenshots. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ company: { timezone: 'Asia/Singapore' } }) }))
vi.mock('../ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../ops/opsApi')>()),
  opsApi: { fetchDocumentFile: vi.fn(() => new Promise(() => undefined)) },
}))

import type { DocumentRow, Expectation, Obligation } from '../ops/opsApi'
import { ComplianceChecklist } from '../company/ComplianceChecklist'
import { DatesView } from './DatesView'
import { MonthGrid } from './MonthGrid'
import { ObligationRow } from './ObligationRow'

const doc = (over: Partial<DocumentRow> = {}): DocumentRow => ({
  id: 1, filename: 'certificate.pdf', media_type: 'application/pdf', lane: 'statutory', doc_type: 'Certificate of Incorporation',
  status: 'filed', received_at: '2026-09-24 05:00:00', description: null, bucket: 'Statutory', vendor_name: null,
  occurred_on: '2026-09-01', ...over,
})

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

describe('DatesView with nothing uploaded (item 7)', () => {
  it('still draws the month grid, with the hint under it instead of in its place', () => {
    render(<DatesView documents={[]} />)
    expect(screen.getAllByRole('button', { pressed: false }).length).toBeGreaterThanOrEqual(28) // the day cells
    expect(screen.getByTestId('no-documents-hint').textContent).toBe('No documents uploaded yet.')
    expect(screen.queryByText(/tap a day with documents/i)).toBeNull() // not two hints at once
  })

  it('uses the renamed toggle labels', () => {
    render(<DatesView documents={[]} />)
    expect(screen.getByRole('button', { name: 'Uploaded' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Document dates' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'When filed' })).toBeNull() // renamed in round 21: it always meant the upload date
    expect(screen.queryByRole('button', { name: 'Upload date' })).toBeNull()
  })

  it('with documents, shows the day prompt and no empty-state hint', () => {
    render(<DatesView documents={[doc()]} />)
    expect(screen.queryByTestId('no-documents-hint')).toBeNull()
    expect(screen.getByText(/tap a day with documents/i)).toBeTruthy()
  })
})

describe('MonthGrid header navigation (item 8)', () => {
  it('the month header is a button, and three taps reach a month in a distant year', () => {
    const onMonthChange = vi.fn()
    render(<MonthGrid month="2026-09-01" documentsByDay={new Map()} selectedDay={null} onSelectDay={vi.fn()} onMonthChange={onMonthChange} timezone="Asia/Singapore" />)

    fireEvent.click(screen.getByRole('button', { name: /september 2026/i })) // tap 1: the year grid
    const years = screen.getByTestId('year-grid')
    expect(within(years).getAllByRole('button')).toHaveLength(24)

    fireEvent.click(within(years).getByRole('button', { name: '2012' })) // tap 2: that year's months
    const months = screen.getByTestId('month-grid')
    expect(within(months).getAllByRole('button')).toHaveLength(12)

    fireEvent.click(within(months).getAllByRole('button')[2]!) // tap 3: March
    expect(onMonthChange).toHaveBeenCalledWith('2012-03-01')
    expect(screen.queryByTestId('month-grid')).toBeNull() // back on the days
  })

  it('the chevrons page by a whole set of years on the year grid, and by year on the month grid', () => {
    render(<MonthGrid month="2026-09-01" documentsByDay={new Map()} selectedDay={null} onSelectDay={vi.fn()} onMonthChange={vi.fn()} timezone="Asia/Singapore" />)
    fireEvent.click(screen.getByRole('button', { name: /september 2026/i }))
    expect(screen.getByRole('button', { name: /2009 - 2032/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Earlier years' }))
    expect(screen.getByRole('button', { name: /1985 - 2008/ })).toBeTruthy()
    expect(within(screen.getByTestId('year-grid')).getByRole('button', { name: '1990' })).toBeTruthy()

    fireEvent.click(within(screen.getByTestId('year-grid')).getByRole('button', { name: '1990' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next year' }))
    expect(screen.getByRole('button', { name: /1991/ })).toBeTruthy()
  })

  it('tapping the header again goes back up one level, then closes', () => {
    render(<MonthGrid month="2026-09-01" documentsByDay={new Map()} selectedDay={null} onSelectDay={vi.fn()} onMonthChange={vi.fn()} timezone="Asia/Singapore" />)
    fireEvent.click(screen.getByRole('button', { name: /september 2026/i }))
    fireEvent.click(within(screen.getByTestId('year-grid')).getByRole('button', { name: '2020' }))
    expect(screen.getByTestId('month-grid')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /2020.*back/i })) // months -> years
    expect(screen.getByTestId('year-grid')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /back/i })) // years -> days
    expect(screen.queryByTestId('year-grid')).toBeNull()
    expect(screen.getByRole('button', { name: /september 2026/i })).toBeTruthy()
  })

  it('the chevrons still move one month at a time on the days', () => {
    const onMonthChange = vi.fn()
    render(<MonthGrid month="2026-09-01" documentsByDay={new Map()} selectedDay={null} onSelectDay={vi.fn()} onMonthChange={onMonthChange} timezone="Asia/Singapore" />)
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(onMonthChange).toHaveBeenLastCalledWith('2026-10-01')
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(onMonthChange).toHaveBeenLastCalledWith('2026-08-01')
  })

})

describe('ObligationRow (item 10a)', () => {
  const ob: Obligation = {
    id: 1, kind: 'annual_return', label: 'File Annual Return', due_on: '2026-07-31', status: 'open', risk: 'high',
    citation: 'Companies Act s197: Annual Return due within 7 months of FYE. Dormancy does not exempt this; AGM/FS exemption is separate (s175A dispensation, s201A audit exemption).',
  }

  it('stacks the title with its status, then the due date with the priority, then the citation, in a list item and not table cells', () => {
    const { container } = render(<ul><ObligationRow obligation={ob} /></ul>)
    const row = screen.getByTestId('obligation-row')
    expect(row.tagName).toBe('LI')
    expect(container.querySelector('table, td, tr')).toBeNull()
    expect(within(row).getByText('File Annual Return')).toBeTruthy()
    expect(within(row).getByText('OPEN', { exact: false }) ?? within(row).getByText(/open/i)).toBeTruthy()
    expect(within(row).getByText('Due 31 Jul 2026')).toBeTruthy()
    expect(within(row).getByText('high')).toBeTruthy()
    expect(within(row).getByText(ob.citation)).toBeTruthy()
  })

  it('limits the citation to two lines', () => {
    render(<ul><ObligationRow obligation={ob} /></ul>)
    expect(screen.getByText(ob.citation).className).toContain('line-clamp-2')
  })

  it('leaves out an empty citation instead of an empty line', () => {
    render(<ul><ObligationRow obligation={{ ...ob, citation: '' }} /></ul>)
    expect(screen.getByTestId('obligation-row').querySelector('p.line-clamp-2')).toBeNull()
  })
})

describe('ComplianceChecklist (item 9)', () => {
  const satisfied: Expectation = { id: 1, doc_type: 'certificate_of_incorporation', label: 'Certificate of Incorporation', due_on: null, status: 'satisfied', evidence_document_id: 1 }
  const missing: Expectation = { id: 2, doc_type: 'constitution', label: 'Company Constitution', due_on: null, status: 'missing', evidence_document_id: null }

  it('is headed "Compliance checklist" with the count, not "gap analysis"', () => {
    render(<ComplianceChecklist expectations={[satisfied, missing]} documents={[doc()]} canUpload />)
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Compliance checklist: 1 of 2 held')
    expect(document.body.textContent).not.toMatch(/gap analysis/i)
  })

  it('a satisfied row links to the document that satisfied it and opens it in the viewer', () => {
    render(<ComplianceChecklist expectations={[satisfied]} documents={[doc()]} canUpload />)
    fireEvent.click(screen.getByRole('button', { name: 'View document' }))
    expect(screen.getByRole('dialog', { name: /certificate\.pdf/ })).toBeTruthy()
  })

  it('offers no link when the evidence is not among the documents this caller was sent, or was never recorded', () => {
    const { rerender } = render(<ComplianceChecklist expectations={[satisfied]} documents={[doc({ id: 99 })]} canUpload />)
    expect(screen.queryByRole('button', { name: 'View document' })).toBeNull()
    rerender(<ComplianceChecklist expectations={[{ ...satisfied, evidence_document_id: null }]} documents={[doc()]} canUpload />)
    expect(screen.queryByRole('button', { name: 'View document' })).toBeNull()
    rerender(<ComplianceChecklist expectations={[{ ...satisfied, evidence_document_id: undefined }]} documents={[doc()]} canUpload />) // an older backend
    expect(screen.queryByRole('button', { name: 'View document' })).toBeNull()
  })

  it('a missing row offers Upload, carrying its doc_type as the hint', () => {
    render(<ComplianceChecklist expectations={[missing]} documents={[]} canUpload />)
    expect(screen.getByRole('link', { name: 'Upload' }).getAttribute('href')).toBe('/upload?for=constitution')
  })

  it('a viewer, who cannot upload, is not offered Upload', () => {
    render(<ComplianceChecklist expectations={[missing]} documents={[]} canUpload={false} />)
    expect(screen.queryByRole('link', { name: 'Upload' })).toBeNull()
  })

  it('a satisfied row has no Upload, and a missing row has no View', () => {
    render(<ComplianceChecklist expectations={[satisfied, missing]} documents={[doc()]} canUpload />)
    const rows = screen.getAllByTestId('checklist-row')
    expect(within(rows[0]!).queryByRole('link', { name: 'Upload' })).toBeNull()
    expect(within(rows[1]!).queryByRole('button', { name: 'View document' })).toBeNull()
  })

  it('says so when there is nothing on the checklist yet', () => {
    render(<ComplianceChecklist expectations={[]} documents={[]} canUpload />)
    expect(screen.getByText(/nothing on the checklist yet/i)).toBeTruthy()
  })
})

describe('DatesView: tapping a day lists that day\'s documents (the ruling of round 21)', () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const dayCell = () => {
    const number = String(Number(today.slice(8, 10)))
    const cell = screen.getAllByRole('button', { pressed: false }).find((b) => b.firstElementChild?.textContent === number && b.hasAttribute('aria-current'))
    if (!cell) throw new Error(`no day cell for ${number}`)
    return cell
  }

  it('lists every document of that day, held checklist evidence included, each opening its file', () => {
    const docs = [
      doc({ id: 1, filename: 'evidence.pdf', doc_type: 'Certificate of Incorporation', received_at: `${today} 03:00:00`, description: JSON.stringify({ en: 'Certificate of Incorporation' }) }),
      doc({ id: 2, filename: 'lease.pdf', status: 'purge_requested', received_at: `${today} 04:00:00`, description: JSON.stringify({ en: 'Old lease' }) }),
    ]
    render(<DatesView documents={docs} />)

    fireEvent.click(dayCell())

    expect(screen.getByText('Certificate of Incorporation')).toBeTruthy()
    expect(screen.getByText('Old lease')).toBeTruthy()
    const rows = screen.getAllByRole('button').filter((b) => /evidence\.pdf|lease\.pdf/.test(b.textContent ?? ''))
    expect(rows).toHaveLength(2)
    expect(within(rows[1]!).getByText('Purge requested')).toBeTruthy() // the owner's own request is marked on the day list too
    fireEvent.click(rows[0]!)
    expect(screen.getByRole('dialog')).toBeTruthy() // the file opens in the viewer
  })
})
