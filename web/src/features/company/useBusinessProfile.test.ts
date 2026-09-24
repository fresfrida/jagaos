import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/apiClient'

vi.mock('../auth/authApi', async (importActual) => ({
  ...(await importActual<typeof import('../auth/authApi')>()),
  authApi: { getBusinessProfile: vi.fn() },
}))
vi.mock('../ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../ops/opsApi')>()),
  opsApi: { uploadDocument: vi.fn(), archiveDocument: vi.fn() },
}))

import { authApi, type BusinessProfileDocument } from '../auth/authApi'
import { opsApi } from '../ops/opsApi'
import { useBusinessProfile } from './useBusinessProfile'

const getBusinessProfile = vi.mocked(authApi.getBusinessProfile)
const uploadDocument = vi.mocked(opsApi.uploadDocument)
const archiveDocument = vi.mocked(opsApi.archiveDocument)

const doc = (id: number): BusinessProfileDocument => ({ id, filename: 'bizfile.pdf', media_type: 'application/pdf', status: 'needs_review', received_at: '2026-09-24 05:00:00', can_prefill: false })
const file = new File(['%PDF'], 'bizfile.pdf', { type: 'application/pdf' })

beforeEach(() => { vi.resetAllMocks() })

describe('useBusinessProfile', () => {
  it('loads the current business profile', async () => {
    getBusinessProfile.mockResolvedValue({ document: doc(7) })
    const { result } = renderHook(() => useBusinessProfile({ enabled: true, language: 'en' }))
    expect(result.current.state).toEqual({ status: 'loading' })
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', document: doc(7) }))
  })

  it('does not fetch for someone who is not the owner', () => {
    renderHook(() => useBusinessProfile({ enabled: false, language: 'en' }))
    expect(getBusinessProfile).not.toHaveBeenCalled()
  })

  it('is unavailable (not failed) against a backend without the endpoint, or one that refuses the caller', async () => {
    getBusinessProfile.mockRejectedValue(new ApiError(404, 'Not Found'))
    const { result } = renderHook(() => useBusinessProfile({ enabled: true, language: 'en' }))
    await waitFor(() => expect(result.current.state).toEqual({ status: 'unavailable' }))
  })

  it('is failed for any other error', async () => {
    getBusinessProfile.mockRejectedValue(new ApiError(500, 'boom'))
    const { result } = renderHook(() => useBusinessProfile({ enabled: true, language: 'en' }))
    await waitFor(() => expect(result.current.state).toEqual({ status: 'failed' }))
  })

  it('uploads through the ordinary upload (a document, not a picture, in the uploader\'s language), then reloads', async () => {
    getBusinessProfile.mockResolvedValueOnce({ document: null }).mockResolvedValueOnce({ document: doc(9) })
    uploadDocument.mockResolvedValue({ document_id: 9, status: 'needs_review' })
    const { result } = renderHook(() => useBusinessProfile({ enabled: true, language: 'ms' }))
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    await act(() => result.current.upload(file))

    expect(uploadDocument).toHaveBeenCalledWith(file, false, 'ms')
    expect(result.current.notice).toBe('uploaded')
    expect(result.current.state).toEqual({ status: 'ready', document: doc(9) })
    expect(result.current.uploading).toBeNull()
  })

  it('says a file that was filed as something else is not a business profile', async () => {
    getBusinessProfile.mockResolvedValue({ document: null })
    uploadDocument.mockResolvedValue({ document_id: 12, status: 'needs_review' })
    const { result } = renderHook(() => useBusinessProfile({ enabled: true, language: 'en' }))
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    await act(() => result.current.upload(file))

    expect(result.current.notice).toBe('notAProfile')
  })

  it('says a different profile than the one uploaded is not the upload either', async () => {
    getBusinessProfile.mockResolvedValue({ document: doc(7) })
    uploadDocument.mockResolvedValue({ document_id: 12, status: 'needs_review' })
    const { result } = renderHook(() => useBusinessProfile({ enabled: true, language: 'en' }))
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    await act(() => result.current.upload(file))

    expect(result.current.notice).toBe('notAProfile')
  })

  it.each([['duplicate' as const, 'duplicate'], ['quarantined' as const, 'quarantined']])('reports a %s result', async (status, notice) => {
    getBusinessProfile.mockResolvedValue({ document: null })
    uploadDocument.mockResolvedValue({ document_id: null, status })
    const { result } = renderHook(() => useBusinessProfile({ enabled: true, language: 'en' }))
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    await act(() => result.current.upload(file))

    expect(result.current.notice).toBe(notice)
  })

  it('reports a failed upload and clears the busy state', async () => {
    getBusinessProfile.mockResolvedValue({ document: null })
    uploadDocument.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useBusinessProfile({ enabled: true, language: 'en' }))
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    await act(() => result.current.upload(file))

    expect(result.current.notice).toBe('failed')
    expect(result.current.uploading).toBeNull()
  })

  it('removes through the existing archive and shows the next one, or none', async () => {
    getBusinessProfile.mockResolvedValueOnce({ document: doc(7) }).mockResolvedValueOnce({ document: null })
    archiveDocument.mockResolvedValue({ status: 'archived' })
    const { result } = renderHook(() => useBusinessProfile({ enabled: true, language: 'en' }))
    await waitFor(() => expect(result.current.state.status).toBe('ready'))

    await act(() => result.current.remove(7))

    expect(archiveDocument).toHaveBeenCalledWith(7)
    expect(result.current.state).toEqual({ status: 'ready', document: null })
    expect(result.current.removing).toBe(false)
  })
})
