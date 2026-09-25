import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../ops/opsApi')>()),
  opsApi: { getLimits: vi.fn() },
}))

import { opsApi, type Limits } from '../ops/opsApi'
import { usePersonalLimits } from './usePersonalLimits'

const getLimits = vi.mocked(opsApi.getLimits)
const limits = (used: number): Limits => ({ max_file_bytes: 26214400, max_personal_files: 15, personal_files_used: used })

beforeEach(() => { vi.resetAllMocks() })

describe('usePersonalLimits', () => {
  it('is null until known, then holds the numbers', async () => {
    getLimits.mockResolvedValue(limits(3))
    const { result } = renderHook(() => usePersonalLimits(true))
    expect(result.current.limits).toBeNull()
    await waitFor(() => expect(result.current.limits).toEqual(limits(3)))
  })

  it('does not fetch when not enabled (a viewer has no allowance)', () => {
    renderHook(() => usePersonalLimits(false))
    expect(getLimits).not.toHaveBeenCalled()
  })

  it('stays null against a backend without the endpoint', async () => {
    getLimits.mockRejectedValue(new Error('404'))
    const { result } = renderHook(() => usePersonalLimits(true))
    await waitFor(() => expect(getLimits).toHaveBeenCalled())
    await Promise.resolve()
    expect(result.current.limits).toBeNull()
  })

  it('a refresh updates the count, and a failed refresh keeps the last numbers', async () => {
    getLimits.mockResolvedValueOnce(limits(3)).mockResolvedValueOnce(limits(2)).mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => usePersonalLimits(true))
    await waitFor(() => expect(result.current.limits?.personal_files_used).toBe(3))

    await act(() => result.current.refresh())
    expect(result.current.limits?.personal_files_used).toBe(2)

    await act(() => result.current.refresh())
    expect(result.current.limits?.personal_files_used).toBe(2)
  })
})
