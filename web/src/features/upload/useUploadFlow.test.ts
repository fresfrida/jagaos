/** Round 16: the upload flow reports what it is sending (for the progress moment)
 * and carries the checklist hint on document uploads only. */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/imageNormalize', () => ({ normalizeImageForUpload: vi.fn(async (f: File) => f) }))
vi.mock('../ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../ops/opsApi')>()),
  opsApi: { uploadDocument: vi.fn(), uploadPages: vi.fn(), getLimits: vi.fn() },
}))

import { ApiError } from '../../lib/apiClient'
import { opsApi } from '../ops/opsApi'
import { resetFileLimitCache } from './fileLimit'
import { useUploadFlow } from './useUploadFlow'

const uploadDocument = vi.mocked(opsApi.uploadDocument)
const uploadPages = vi.mocked(opsApi.uploadPages)

const pdf = new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' })
const jpg = (name: string) => new File(['x'], name, { type: 'image/jpeg' })

const hook = (docTypeHint?: string | null, visibility?: 'company' | 'only_me') =>
  renderHook(() => useUploadFlow({ language: 'en', refresh: vi.fn(async () => undefined), onOutcome: vi.fn(), onError: vi.fn(), docTypeHint, visibility }))

beforeEach(() => { vi.resetAllMocks(); resetFileLimitCache() })

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

  describe('the file-size limit (round 20, item 6)', () => {
    const MB = 1024 * 1024
    const big = (name: string, type: string) => Object.defineProperty(new File(['x'], name, { type }), 'size', { value: 25 * MB + 1 }) as File
    const flow = () => {
      const onError = vi.fn()
      const view = renderHook(() => useUploadFlow({ language: 'en', refresh: vi.fn(async () => undefined), onOutcome: vi.fn(), onError }))
      return { ...view, onError }
    }
    beforeEach(() => { vi.mocked(opsApi.getLimits).mockResolvedValue({ max_file_bytes: 25 * MB, max_personal_files: 15, personal_files_used: 0 }) })

    it('a file over the limit is refused before anything is sent, and the page is handed the error to translate', async () => {
      const { result, onError } = flow()

      await act(async () => { result.current.chooseDocumentFiles([big('huge.pdf', 'application/pdf')]) })

      expect(uploadDocument).not.toHaveBeenCalled()
      const [message, error] = onError.mock.calls.at(-1)!
      expect(message).toContain('larger')
      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({ status: 413, code: 'file_too_large' })
      expect(result.current.busy).toBe(false)
    })

    it('a photo is judged AFTER it is downscaled: a huge phone photo that becomes small is sent', async () => {
      const { normalizeImageForUpload } = await import('../../lib/imageNormalize')
      vi.mocked(normalizeImageForUpload).mockResolvedValueOnce(jpg('small.jpg'))
      uploadDocument.mockResolvedValue({ document_id: 1, status: 'needs_review' })
      const { result } = flow()

      await act(async () => { result.current.uploadPhoto(big('phone.jpg', 'image/jpeg')) })

      expect(uploadDocument).toHaveBeenCalledTimes(1)
    })

    it('several pages: one page over the limit refuses the whole set before anything is sent', async () => {
      const { result, onError } = flow()
      act(() => result.current.chooseDocumentFiles([jpg('p1.jpg'), big('p2.jpg', 'image/jpeg')]))

      await act(async () => { await result.current.submitPages() })

      expect(uploadPages).not.toHaveBeenCalled()
      expect(onError.mock.calls.at(-1)![1]).toMatchObject({ code: 'file_too_large' })
    })

    it('a file exactly at the limit is sent', async () => {
      uploadDocument.mockResolvedValue({ document_id: 1, status: 'needs_review' })
      const { result } = flow()
      const exact = Object.defineProperty(new File(['x'], 'ok.pdf', { type: 'application/pdf' }), 'size', { value: 25 * MB }) as File

      await act(async () => { result.current.chooseDocumentFiles([exact]) })

      expect(uploadDocument).toHaveBeenCalledTimes(1)
    })

    it('a server refusal (413 or 409) reaches the page with its error, so it can translate it', async () => {
      uploadDocument.mockRejectedValue(new ApiError(409, 'full', 'personal_file_limit', { limit: 15 }))
      const { result, onError } = flow()

      await act(async () => { result.current.chooseDocumentFiles([pdf]) })

      expect(onError.mock.calls.at(-1)![1]).toMatchObject({ code: 'personal_file_limit' })
    })
  })
})
