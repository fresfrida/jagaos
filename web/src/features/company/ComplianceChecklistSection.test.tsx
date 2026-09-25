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
})
