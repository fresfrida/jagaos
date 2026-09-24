import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../ops/opsApi')>()),
  opsApi: { listPersonalFiles: vi.fn() },
}))

import { opsApi, type DocumentRow } from '../ops/opsApi'
import { usePersonalFiles } from './usePersonalFiles'

const listPersonalFiles = vi.mocked(opsApi.listPersonalFiles)
const row = (id: number): DocumentRow => ({
  id, filename: `f${id}.pdf`, media_type: 'application/pdf', lane: null, doc_type: null, status: 'needs_review',
  received_at: '2026-09-25 05:00:00', description: null, bucket: null, vendor_name: null, occurred_on: null, visibility: 'only_me',
})

beforeEach(() => { vi.resetAllMocks() })

describe('usePersonalFiles', () => {
  it('starts loading, then holds the caller\'s personal files', async () => {
    listPersonalFiles.mockResolvedValue([row(1), row(2)])
    const { result } = renderHook(() => usePersonalFiles(true))
    expect(result.current.state).toEqual({ status: 'loading' })
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', files: [row(1), row(2)] }))
  })

  it('does not fetch when it is not enabled (a role with no Only me)', () => {
    renderHook(() => usePersonalFiles(false))
    expect(listPersonalFiles).not.toHaveBeenCalled()
  })

  it('a failed first load is a visible failure, and retry loads again', async () => {
    listPersonalFiles.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([row(3)])
    const { result } = renderHook(() => usePersonalFiles(true))
    await waitFor(() => expect(result.current.state).toEqual({ status: 'failed', message: 'boom' }))

    act(() => result.current.retry())

    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', files: [row(3)] }))
  })

  it('a refresh replaces the list, and a refresh that fails keeps the last good list instead of blanking it', async () => {
    listPersonalFiles.mockResolvedValueOnce([row(1)]).mockResolvedValueOnce([row(1), row(2)]).mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => usePersonalFiles(true))
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    await act(() => result.current.refresh())
    expect(result.current.state).toEqual({ status: 'ready', files: [row(1), row(2)] })

    await act(() => result.current.refresh())
    expect(result.current.state).toEqual({ status: 'ready', files: [row(1), row(2)] })
  })
})
