import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../ops/opsApi')>()),
  opsApi: { searchTerms: vi.fn() },
}))

import { ApiError } from '../../lib/apiClient'
import { opsApi } from '../ops/opsApi'
import { useSearchTerms } from './useSearchTerms'

const searchTerms = vi.mocked(opsApi.searchTerms)
beforeEach(() => vi.resetAllMocks())

describe('useSearchTerms', () => {
  it('loads once, and is ready with the words', async () => {
    searchTerms.mockResolvedValue([{ term: 'lease', count: 3 }])
    const { result } = renderHook(() => useSearchTerms(true))
    expect(result.current.state).toEqual({ status: 'loading' })

    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', terms: [{ term: 'lease', count: 3 }] }))
    expect(searchTerms).toHaveBeenCalledTimes(1)
  })

  it('a backend without the endpoint (404) is "unavailable", not an error to show', async () => {
    searchTerms.mockRejectedValue(new ApiError(404, 'Not Found'))
    const { result } = renderHook(() => useSearchTerms(true))
    await waitFor(() => expect(result.current.state).toEqual({ status: 'unavailable' }))
  })

  it('any other failure is "failed", and retry loads again', async () => {
    searchTerms.mockRejectedValueOnce(new ApiError(500, 'boom'))
    const { result } = renderHook(() => useSearchTerms(true))
    await waitFor(() => expect(result.current.state).toEqual({ status: 'failed' }))

    searchTerms.mockResolvedValue([])
    act(() => result.current.retry())
    expect(result.current.state).toEqual({ status: 'loading' })
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', terms: [] }))
  })

  it('asks for nothing while disabled', () => {
    renderHook(() => useSearchTerms(false))
    expect(searchTerms).not.toHaveBeenCalled()
  })
})
