/** Search: the word cloud before anything is searched, and a word that runs its search (round 21, A8, DECISIONS #101). */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const auth = vi.hoisted(() => ({ value: { status: 'signed-in', role: 'user' } as { status: string; role: string | null } }))
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => auth.value, useOptionalAuth: () => auth.value }))
vi.mock('../features/ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../features/ops/opsApi')>()),
  opsApi: { search: vi.fn(), searchTerms: vi.fn(), health: vi.fn(), archiveDocument: vi.fn() },
}))

import { ApiError } from '../lib/apiClient'
import { opsApi, type DocumentRow } from '../features/ops/opsApi'
import { SearchPage } from './SearchPage'

const search = vi.mocked(opsApi.search)
const searchTerms = vi.mocked(opsApi.searchTerms)
const doc = (id: number): DocumentRow => ({
  id, filename: `lease-${id}.txt`, media_type: 'text/plain', lane: null, doc_type: null, status: 'filed', received_at: '2026-09-01 01:00:00',
  description: JSON.stringify({ en: `Result ${id}` }), bucket: null, vendor_name: null, occurred_on: null, can_edit: true,
})

beforeEach(async () => {
  vi.resetAllMocks()
  auth.value = { status: 'signed-in', role: 'user' }
  vi.mocked(opsApi.health).mockResolvedValue({ status: 'ok' })
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('Search page word cloud', () => {
  it('shows the cloud under the prompt before anything is searched', async () => {
    searchTerms.mockResolvedValue([{ term: 'lease', count: 3 }, { term: 'office', count: 2 }])
    render(<SearchPage />)

    expect(screen.getByText('Type something above to search your documents.')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'lease (3)' })).toBeTruthy()
    expect(searchTerms).toHaveBeenCalledTimes(1)
  })

  it('tapping a word puts it in the box and runs that search, replacing the cloud with the results', async () => {
    searchTerms.mockResolvedValue([{ term: 'lease', count: 3 }])
    search.mockResolvedValue([doc(1), doc(2)])
    render(<SearchPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'lease (3)' }))

    await waitFor(() => expect(search).toHaveBeenCalledWith('lease'))
    expect((screen.getByPlaceholderText('Search documents…') as HTMLInputElement).value).toBe('lease')
    expect(await screen.findByText('Result 1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'lease (3)' })).toBeNull()
  })

  it('clearing the search brings the cloud back', async () => {
    searchTerms.mockResolvedValue([{ term: 'lease', count: 3 }])
    search.mockResolvedValue([doc(1)])
    render(<SearchPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'lease (3)' }))
    await screen.findByText('Result 1')

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(await screen.findByRole('button', { name: 'lease (3)' })).toBeTruthy()
    expect(searchTerms).toHaveBeenCalledTimes(1) // it is not asked for again
  })

  it('a backend without the cloud leaves the page exactly as it was', async () => {
    searchTerms.mockRejectedValue(new ApiError(404, 'Not Found'))
    render(<SearchPage />)
    await act(async () => { await Promise.resolve() })
    await waitFor(() => expect(searchTerms).toHaveBeenCalled())

    expect(screen.getByText('Type something above to search your documents.')).toBeTruthy()
    expect(screen.queryByTestId('word-cloud')).toBeNull()
    expect(screen.queryByText(/could not be loaded/)).toBeNull()
  })

  it('shows nothing for an empty cloud, and says when it could not load', async () => {
    searchTerms.mockResolvedValue([])
    render(<SearchPage />)
    await waitFor(() => expect(searchTerms).toHaveBeenCalled())
    expect(screen.queryByTestId('word-cloud')).toBeNull()
    cleanup()

    searchTerms.mockRejectedValue(new ApiError(500, 'boom'))
    render(<SearchPage />)
    expect(await screen.findByText('The word cloud could not be loaded.')).toBeTruthy()
  })
})
