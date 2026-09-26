/** The owner's pending purge requests, on their own page under Company Settings (round 21, A5, DECISIONS #101; round 3, items 9b and 9c,
 * DECISIONS #121: a page of their own, and a pending request can be taken back). */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

vi.mock('../ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../ops/opsApi')>()),
  opsApi: { listPurgeRequests: vi.fn(), cancelPurgeRequest: vi.fn() },
}))

import { opsApi } from '../ops/opsApi'
import { PurgeRequestsSection } from './PurgeRequestsSection'

const list = vi.mocked(opsApi.listPurgeRequests)

beforeEach(async () => {
  vi.resetAllMocks()
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('PurgeRequestsSection', () => {
  it('lists each request with what it is, when, and who asked', async () => {
    list.mockResolvedValue([
      { id: 5, filename: 'old-contract.pdf', requested_at: '2026-09-25 09:30:00', requested_by: 'owner_priya@try-demo.test' },
      { id: 3, filename: 'draft.pdf', requested_at: '2026-09-20 01:00:00', requested_by: null },
    ])
    render(<PurgeRequestsSection enabled />)

    const rows = await screen.findAllByTestId('purge-request-row')
    expect(rows).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'Purge requests (2)' })).toBeTruthy()
    expect(within(rows[0]!).getByText('old-contract.pdf')).toBeTruthy()
    expect(within(rows[0]!).getByText('Purge requested: the team removes it permanently.')).toBeTruthy()
    expect(within(rows[0]!).getByText('Requested 25 Sept 2026 by owner_priya@try-demo.test')).toBeTruthy()
    expect(within(rows[1]!).getByText('Requested 20 Sept 2026 by -')).toBeTruthy()
  })

  it('says there are none', async () => {
    list.mockResolvedValue([])
    render(<PurgeRequestsSection enabled />)
    expect(await screen.findByText('No purge requests.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Purge requests (0)' })).toBeTruthy()
  })

  it('shows loading, then a failure with Try again', async () => {
    list.mockRejectedValueOnce(new Error('403'))
    render(<PurgeRequestsSection enabled />)
    expect(screen.getByRole('status').textContent).toBe('Loading purge requests…')

    expect((await screen.findByRole('alert')).textContent).toContain('The purge requests could not be loaded.')
    list.mockResolvedValue([])
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.getByText('No purge requests.')).toBeTruthy())
  })

  it('deletes nothing: the only action on a row is Cancel purge, which takes the request back', async () => {
    list.mockResolvedValue([{ id: 5, filename: 'a.pdf', requested_at: '2026-09-25 09:30:00', requested_by: 'o@x.y' }])
    render(<PurgeRequestsSection enabled />)
    await screen.findByTestId('purge-request-row')
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel purge'])
  })
})

describe('PurgeRequestsSection: cancelling a pending request (round 3, item 9b)', () => {
  const two = [
    { id: 5, filename: 'old-contract.pdf', requested_at: '2026-09-25 09:30:00', requested_by: 'o@x.y' },
    { id: 3, filename: 'draft.pdf', requested_at: '2026-09-20 01:00:00', requested_by: 'o@x.y' },
  ]

  it('cancels that request, re-reads the list so the row is gone, and says which file is back', async () => {
    list.mockResolvedValueOnce(two).mockResolvedValue([two[1]!])
    vi.mocked(opsApi.cancelPurgeRequest).mockResolvedValue({ status: 'filed' })
    render(<PurgeRequestsSection enabled />)
    const rows = await screen.findAllByTestId('purge-request-row')

    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Cancel purge' }))

    await waitFor(() => expect(opsApi.cancelPurgeRequest).toHaveBeenCalledWith(5))
    await waitFor(() => expect(screen.getAllByTestId('purge-request-row')).toHaveLength(1))
    expect(screen.getByRole('heading', { name: 'Purge requests (1)' })).toBeTruthy()
    expect(screen.queryByText('old-contract.pdf', { selector: 'p' })).toBeNull() // the row went, only the notice below names it
    expect(screen.getByRole('status').textContent).toBe('The purge request for "old-contract.pdf" was cancelled. It is back in Company Files.')
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('disables the other rows while one is being cancelled, so two cancels cannot race', async () => {
    list.mockResolvedValue(two)
    let finish: () => void = () => undefined
    vi.mocked(opsApi.cancelPurgeRequest).mockReturnValue(new Promise((resolve) => { finish = () => resolve({ status: 'filed' }) }))
    render(<PurgeRequestsSection enabled />)
    const rows = await screen.findAllByTestId('purge-request-row')

    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Cancel purge' }))

    await waitFor(() => expect((within(rows[1]!).getByRole('button', { name: 'Cancel purge' }) as HTMLButtonElement).disabled).toBe(true))
    finish()
  })

  it('shows the refusal, keeps the row, and claims nothing', async () => {
    list.mockResolvedValue(two)
    vi.mocked(opsApi.cancelPurgeRequest).mockRejectedValue(new Error('the status this document had before the purge request cannot be determined'))
    render(<PurgeRequestsSection enabled />)
    const rows = await screen.findAllByTestId('purge-request-row')

    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Cancel purge' }))

    expect((await screen.findByRole('alert')).textContent).toContain('cannot be determined')
    expect(screen.getAllByTestId('purge-request-row')).toHaveLength(2)
    expect(screen.queryByText(/was cancelled/)).toBeNull()
  })
})

describe('PurgeRequestsSection: a real label first, the file name under it (DECISIONS #109)', () => {
  it('shows the document\'s own label as the title and the file name as small text beneath', async () => {
    list.mockResolvedValue([
      { id: 5, filename: '1790145560513.pdf', description: JSON.stringify({ en: 'Office lease for Level 3' }), doc_type: 'lease', vendor_name: null, requested_at: '2026-09-25 09:30:00', requested_by: 'o@x.y' },
      { id: 4, filename: 'scan-88.pdf', description: null, doc_type: 'invoice', vendor_name: 'Acme Pte Ltd', requested_at: '2026-09-24 09:30:00', requested_by: 'o@x.y' },
    ])
    render(<PurgeRequestsSection enabled />)
    const rows = await screen.findAllByTestId('purge-request-row')

    expect(within(rows[0]!).getByText('Office lease for Level 3')).toBeTruthy() // the description, in the page's language
    expect(within(rows[0]!).getByTitle('1790145560513.pdf').className).toContain('text-[12px]') // the file name, small, under it
    expect(within(rows[1]!).getByText('Acme Pte Ltd · invoice')).toBeTruthy() // vendor and type when there is a vendor, as everywhere else
    expect(within(rows[1]!).getByTitle('scan-88.pdf')).toBeTruthy()
  })

  it('with nothing to label it by (an older backend, or a document with no description) the file name is the title, once, as before', async () => {
    list.mockResolvedValue([{ id: 5, filename: 'old-contract.pdf', requested_at: '2026-09-25 09:30:00', requested_by: 'o@x.y' }])
    render(<PurgeRequestsSection enabled />)
    const row = await screen.findByTestId('purge-request-row')
    expect(within(row).getAllByText('old-contract.pdf')).toHaveLength(1)
    expect(within(row).queryByTitle('old-contract.pdf')).toBeNull() // no second, smaller copy of it
  })

  it('reads the description in the chosen language', async () => {
    await i18n.changeLanguage('ms')
    list.mockResolvedValue([{ id: 5, filename: 'x.pdf', description: JSON.stringify({ en: 'Office lease', ms: 'Pajakan pejabat' }), doc_type: 'lease', vendor_name: null, requested_at: '2026-09-25 09:30:00', requested_by: 'o@x.y' }])
    render(<PurgeRequestsSection enabled />)
    expect(await screen.findByText('Pajakan pejabat')).toBeTruthy()
  })
})

