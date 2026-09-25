/** The owner's pending purge requests, in Company Settings (round 21, A5, DECISIONS #101). */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

vi.mock('../ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../ops/opsApi')>()),
  opsApi: { listPurgeRequests: vi.fn() },
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
      { id: 5, filename: 'old-contract.pdf', requested_at: '2026-09-25 09:30:00', requested_by: 'owner@try-demo.test' },
      { id: 3, filename: 'draft.pdf', requested_at: '2026-09-20 01:00:00', requested_by: null },
    ])
    render(<PurgeRequestsSection enabled />)

    const rows = await screen.findAllByTestId('purge-request-row')
    expect(rows).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'Purge requests (2)' })).toBeTruthy()
    expect(within(rows[0]!).getByText('old-contract.pdf')).toBeTruthy()
    expect(within(rows[0]!).getByText('Purge requested: the team removes it permanently.')).toBeTruthy()
    expect(within(rows[0]!).getByText('Requested 25 Sept 2026 by owner@try-demo.test')).toBeTruthy()
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

  it('is read-only: nothing on it deletes or changes anything', async () => {
    list.mockResolvedValue([{ id: 5, filename: 'a.pdf', requested_at: '2026-09-25 09:30:00', requested_by: 'o@x.y' }])
    render(<PurgeRequestsSection enabled />)
    await screen.findByTestId('purge-request-row')
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
