/** The compliance checklist in Company Settings (round 21, A2, DECISIONS #101): its own scoped fetch, with visible loading and
 * failed states, then the same checklist rows the Calendar used to show. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

vi.mock('../ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../ops/opsApi')>()),
  opsApi: { listExpectations: vi.fn(), listDocuments: vi.fn(), fetchDocumentThumbnail: vi.fn() },
}))

import { opsApi, type DocumentRow, type Expectation } from '../ops/opsApi'
import { ComplianceChecklistSection } from './ComplianceChecklistSection'

const expectations = vi.mocked(opsApi.listExpectations)
const documents = vi.mocked(opsApi.listDocuments)
const exp = (id: number, status: string, evidence: number | null = null): Expectation =>
  ({ id, doc_type: `type-${id}`, label: `Item ${id}`, status, evidence_document_id: evidence } as Expectation)
const evidenceDoc = { id: 9, filename: 'cert.pdf', media_type: 'application/pdf', status: 'filed' } as DocumentRow

beforeEach(async () => {
  vi.resetAllMocks()
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('ComplianceChecklistSection', () => {
  it('loads the expectations and the documents together, and shows every row with its status', async () => {
    expectations.mockResolvedValue([exp(1, 'satisfied', 9), exp(2, 'missing')])
    documents.mockResolvedValue([evidenceDoc])
    render(<ComplianceChecklistSection enabled />)

    expect(screen.getByRole('status').textContent).toBe('Loading the checklist…')
    expect(await screen.findAllByTestId('checklist-row')).toHaveLength(2)
    expect(screen.getByText('Item 1')).toBeTruthy()
    expect(screen.getByText('Compliance checklist: 1 of 2 held')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'View document' })).toBeTruthy() // the evidence link works: the documents were fetched
    expect(expectations).toHaveBeenCalledTimes(1)
    expect(documents).toHaveBeenCalledTimes(1)
  })

  it('a held row reads "on record", the displayed word for the satisfied status; the status itself is still `satisfied` (DECISIONS #118)', async () => {
    expectations.mockResolvedValue([exp(1, 'satisfied', 9), exp(2, 'missing')])
    documents.mockResolvedValue([evidenceDoc])
    render(<ComplianceChecklistSection enabled />)
    await screen.findAllByTestId('checklist-row')
    const [held, missing] = screen.getAllByTestId('checklist-row')
    expect(held!.textContent).toContain('on record')
    expect(held!.textContent).not.toContain('satisfied')
    expect(missing!.textContent).toContain('missing') // the other status word is untouched
    expect(screen.getByText('Compliance checklist: 1 of 2 held')).toBeTruthy() // still counted by the enum, which did not change
  })

  it.each([
    ['en', 'on record'],
    ['zh', '已有记录'],
    ['ms', 'dalam rekod'],
    ['ta', 'பதிவில் உள்ளது'],
  ])('the satisfied status is worded "%s" in every language (only the display string changed)', async (language, word) => {
    await i18n.changeLanguage(language)
    expect(i18n.t('ops.status.satisfied')).toBe(word)
  })

  it('a missing row offers Upload, because everyone who can see Company Settings can upload', async () => {
    expectations.mockResolvedValue([exp(2, 'missing')])
    documents.mockResolvedValue([])
    render(<ComplianceChecklistSection enabled />)
    expect(await screen.findByRole('link', { name: 'Upload' })).toBeTruthy()
  })

  it('fetches nothing until it is enabled', () => {
    render(<ComplianceChecklistSection enabled={false} />)
    expect(expectations).not.toHaveBeenCalled()
    expect(documents).not.toHaveBeenCalled()
  })

  it('says so when it cannot load, and Try again loads it', async () => {
    expectations.mockRejectedValueOnce(new Error('down'))
    documents.mockResolvedValue([])
    render(<ComplianceChecklistSection enabled />)

    expect((await screen.findByRole('alert')).textContent).toContain('The checklist could not be loaded.')
    expectations.mockResolvedValue([exp(1, 'missing')])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(screen.getByText('Item 1')).toBeTruthy())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('an empty checklist says what would fill it', async () => {
    expectations.mockResolvedValue([])
    documents.mockResolvedValue([])
    render(<ComplianceChecklistSection enabled />)
    expect(await screen.findByText(/Nothing on the checklist yet/)).toBeTruthy()
  })

  it('a slim progress bar shows how many are held, and each row has one quiet action: View when held, Upload when missing', async () => {
    expectations.mockResolvedValue([exp(1, 'satisfied', 9), exp(2, 'missing'), exp(3, 'missing')])
    documents.mockResolvedValue([evidenceDoc])
    render(<ComplianceChecklistSection enabled />)
    const rows = await screen.findAllByTestId('checklist-row')
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('1')
    expect(bar.getAttribute('aria-valuemax')).toBe('3')
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('33.33333333333333%')
    expect(rows[0]!.querySelectorAll('button, a')).toHaveLength(1)
    expect(rows[0]!.textContent).toContain('View')
    expect(rows[1]!.querySelectorAll('button, a')).toHaveLength(1)
    expect(rows[1]!.textContent).toContain('Upload')
  })

  it('the row stacks on a phone (name on its own full-width line, then pill left and action right) and is one line from `sm` up', async () => {
    expectations.mockResolvedValue([exp(1, 'satisfied', 9), exp(2, 'missing')])
    documents.mockResolvedValue([evidenceDoc])
    render(<ComplianceChecklistSection enabled />)
    const [held, missing] = await screen.findAllByTestId('checklist-row')
    for (const row of [held!, missing!]) {
      expect(row.className).toContain('flex-wrap')
      expect(row.className).toContain('sm:flex-nowrap')
      const [name, pill, action] = Array.from(row.children) as HTMLElement[]
      expect(name!.className).toContain('basis-full') // the name takes the whole first line on a phone
      expect(name!.className).toContain('sm:flex-1')
      expect(pill!.className).not.toContain(' w-') // no fixed width below `sm`; only `sm:w-…`
      expect(pill!.className).toContain('sm:w-[6.25rem]')
      expect(action!.className).toContain('ml-auto') // the action sits at the right end of the second line
      expect(action!.className).toContain('sm:w-16')
      expect(name!.className).not.toMatch(/truncate|line-clamp/) // never truncated
    }
  })
})
