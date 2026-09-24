/** Round 16: the upload flow reports what it is sending (for the progress moment)
 * and carries the checklist hint on document uploads only. */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/imageNormalize', () => ({ normalizeImageForUpload: vi.fn(async (f: File) => f) }))
vi.mock('../ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../ops/opsApi')>()),
  opsApi: { uploadDocument: vi.fn(), uploadPages: vi.fn() },
}))

import { opsApi } from '../ops/opsApi'
import { useUploadFlow } from './useUploadFlow'

const uploadDocument = vi.mocked(opsApi.uploadDocument)
const uploadPages = vi.mocked(opsApi.uploadPages)

const pdf = new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' })
const jpg = (name: string) => new File(['x'], name, { type: 'image/jpeg' })

const hook = (docTypeHint?: string | null, visibility?: 'company' | 'only_me') =>
  renderHook(() => useUploadFlow({ language: 'en', refresh: vi.fn(async () => undefined), onOutcome: vi.fn(), onError: vi.fn(), docTypeHint, visibility }))

beforeEach(() => { vi.resetAllMocks() })

describe('useUploadFlow', () => {
  it('reports the file being sent while it is sent, and nothing before or after', async () => {
    let finish: () => void = () => undefined
    uploadDocument.mockReturnValue(new Promise((resolve) => { finish = () => resolve({ document_id: 1, status: 'needs_review' }) }))
    const { result } = hook()
    expect(result.current.uploading).toBeNull()

    act(() => result.current.chooseDocumentFiles([pdf]))
    await vi.waitFor(() => expect(result.current.uploading).toEqual({ name: 'invoice.pdf' }))
    expect(result.current.busy).toBe(true)

    await act(async () => { finish() })
    await vi.waitFor(() => expect(result.current.uploading).toBeNull())
    expect(result.current.busy).toBe(false)
  })

  it('sends the checklist hint with a document upload', async () => {
    uploadDocument.mockResolvedValue({ document_id: 1, status: 'needs_review' })
    const { result } = hook('constitution')

    await act(async () => { result.current.chooseDocumentFiles([pdf]) })

    expect(uploadDocument).toHaveBeenCalledWith(pdf, false, 'en', { docTypeHint: 'constitution', visibility: undefined })
  })

  it('does not send it with a photo, which is never classified from its text', async () => {
    uploadDocument.mockResolvedValue({ document_id: 1, status: 'needs_review' })
    const { result } = hook('constitution')

    await act(async () => { result.current.uploadPhoto(jpg('room.jpg')) })

    expect(uploadDocument).toHaveBeenCalledWith(expect.any(File), true, 'en', { docTypeHint: null, visibility: undefined })
  })

  it('sends it with several photos merged into one document, and reports the page count', async () => {
    uploadPages.mockResolvedValue({ document_id: 2, status: 'needs_review' })
    const { result } = hook('agm_minutes')
    act(() => result.current.chooseDocumentFiles([jpg('p1.jpg'), jpg('p2.jpg'), jpg('p3.jpg')]))
    expect(result.current.staged).toHaveLength(3)

    await act(async () => { await result.current.submitPages() })

    expect(uploadPages).toHaveBeenCalledWith(expect.any(Array), 'en', { docTypeHint: 'agm_minutes', visibility: undefined })
    expect(uploadPages.mock.calls[0]![0]).toHaveLength(3)
  })

  it('without a hint nothing extra is sent', async () => {
    uploadDocument.mockResolvedValue({ document_id: 1, status: 'needs_review' })
    const { result } = hook()

    await act(async () => { result.current.chooseDocumentFiles([pdf]) })

    expect(uploadDocument).toHaveBeenCalledWith(pdf, false, 'en', { docTypeHint: undefined, visibility: undefined })
  })

  it('a flow made for the Only me section sends every upload as a personal file: a document, a photo and merged pages', async () => {
    uploadDocument.mockResolvedValue({ document_id: 1, status: 'needs_review' })
    uploadPages.mockResolvedValue({ document_id: 2, status: 'needs_review' })
    const { result } = hook(null, 'only_me')

    await act(async () => { result.current.chooseDocumentFiles([pdf]) })
    await act(async () => { result.current.uploadPhoto(jpg('private.jpg')) })
    act(() => result.current.chooseDocumentFiles([jpg('p1.jpg'), jpg('p2.jpg')]))
    await act(async () => { await result.current.submitPages() })

    expect(uploadDocument).toHaveBeenNthCalledWith(1, pdf, false, 'en', { docTypeHint: null, visibility: 'only_me' })
    expect(uploadDocument).toHaveBeenNthCalledWith(2, expect.any(File), true, 'en', { docTypeHint: null, visibility: 'only_me' })
    expect(uploadPages).toHaveBeenCalledWith(expect.any(Array), 'en', { docTypeHint: null, visibility: 'only_me' })
  })
})
