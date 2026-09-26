/** Round 16: the upload flow reports what it is sending (for the progress moment)
 * and carries the checklist hint on document uploads only. */

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/imageNormalize', () => ({ normalizeImageForUpload: vi.fn(async (f: File) => f) }))
vi.mock('../../lib/exifDate', () => ({ readExifDate: vi.fn(async () => null) }))
vi.mock('../ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../ops/opsApi')>()),
  opsApi: { uploadDocument: vi.fn(), uploadPages: vi.fn(), getLimits: vi.fn() },
}))

import { ApiError } from '../../lib/apiClient'
import { readExifDate } from '../../lib/exifDate'
import { opsApi } from '../ops/opsApi'
import { resetFileLimitCache } from './fileLimit'
import { defaultPersonalName, useUploadFlow } from './useUploadFlow'

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

  describe('an Only me flow holds every choice for a name (round 21, A3)', () => {
    const only = () => hook(null, 'only_me')

    it('a document is held, not sent; saving sends it as a personal file with the name and caption', async () => {
      uploadDocument.mockResolvedValue({ document_id: 1, status: 'filed' })
      const { result } = only()

      act(() => result.current.chooseDocumentFiles([pdf]))

      expect(uploadDocument).not.toHaveBeenCalled()
      expect(result.current.draft).toEqual({ files: [pdf], isPicture: false, defaultName: 'invoice' })
      await act(async () => { await result.current.saveDraft({ name: 'Lease', caption: 'Signed copy' }) })
      expect(uploadDocument).toHaveBeenCalledWith(pdf, false, 'en', { docTypeHint: null, visibility: 'only_me', name: 'Lease', caption: 'Signed copy' })
      expect(result.current.draft).toBeNull()
    })

    it('a photo is held the same way, and the promise its caller waits on resolves true once it was sent', async () => {
      uploadDocument.mockResolvedValue({ document_id: 1, status: 'filed' })
      const { result } = only()
      let answer: Promise<boolean> = Promise.resolve(false)

      act(() => { answer = result.current.uploadPhoto(jpg('private.jpg')) })
      expect(uploadDocument).not.toHaveBeenCalled()
      expect(result.current.draft).toMatchObject({ isPicture: true, defaultName: 'private' })
      await act(async () => { await result.current.saveDraft({ name: 'Me' }) })

      await expect(answer).resolves.toBe(true)
      expect(uploadDocument).toHaveBeenCalledWith(expect.any(File), true, 'en', { docTypeHint: null, visibility: 'only_me', name: 'Me' })
    })

    it('cancelling sends nothing and answers false, so a scratchpad keeps its drawing', async () => {
      const { result } = only()
      let answer: Promise<boolean> = Promise.resolve(true)
      act(() => { answer = result.current.uploadPhoto(jpg('note.png')) })

      act(() => result.current.cancelDraft())

      await expect(answer).resolves.toBe(false)
      expect(uploadDocument).not.toHaveBeenCalled()
      expect(result.current.draft).toBeNull()
    })

    it('a newer choice replaces one that was never named, and the older one is answered false', async () => {
      const { result } = only()
      let first: Promise<boolean> = Promise.resolve(true)
      act(() => { first = result.current.uploadPhoto(jpg('one.jpg')) })

      act(() => { void result.current.uploadPhoto(jpg('two.jpg')) })

      await expect(first).resolves.toBe(false)
      expect(result.current.draft).toMatchObject({ defaultName: 'two' })
    })

    it('several photos are staged, then held for one name, then sent together as pages, and the staging clears', async () => {
      uploadPages.mockResolvedValue({ document_id: 2, status: 'filed' })
      const { result } = only()
      act(() => result.current.chooseDocumentFiles([jpg('p1.jpg'), jpg('p2.jpg')]))
      expect(result.current.staged).toHaveLength(2)
      let submitted: Promise<void> = Promise.resolve()

      act(() => { submitted = result.current.submitPages() })
      expect(uploadPages).not.toHaveBeenCalled()
      expect(result.current.draft?.files).toHaveLength(2)
      await act(async () => { await result.current.saveDraft({ name: 'Pages', caption: 'All four' }); await submitted })

      expect(uploadPages).toHaveBeenCalledWith(expect.any(Array), 'en', { docTypeHint: null, visibility: 'only_me', name: 'Pages', caption: 'All four' })
      expect(result.current.staged).toBeNull()
    })

    it('cancelling the name of staged pages keeps them staged', async () => {
      const { result } = only()
      act(() => result.current.chooseDocumentFiles([jpg('p1.jpg'), jpg('p2.jpg')]))
      let submitted: Promise<void> = Promise.resolve()
      act(() => { submitted = result.current.submitPages() })

      await act(async () => { result.current.cancelDraft(); await submitted })

      expect(uploadPages).not.toHaveBeenCalled()
      expect(result.current.staged).toHaveLength(2)
    })

    it('a failed send closes the sheet, reports the error and answers false; the file is not sent twice', async () => {
      uploadDocument.mockRejectedValue(new Error('boom'))
      const onError = vi.fn()
      const { result } = renderHook(() => useUploadFlow({ language: 'en', refresh: vi.fn(async () => undefined), onOutcome: vi.fn(), onError, visibility: 'only_me' }))
      let answer: Promise<boolean> = Promise.resolve(true)
      act(() => { answer = result.current.uploadPhoto(jpg('a.jpg')) })

      await act(async () => { await result.current.saveDraft({ name: 'A' }) })

      await expect(answer).resolves.toBe(false)
      expect(result.current.draft).toBeNull()
      expect(onError.mock.calls.at(-1)![0]).toBe('boom')
      expect(uploadDocument).toHaveBeenCalledTimes(1)
    })

    it('saving with nothing held does nothing', async () => {
      const { result } = only()
      await act(async () => { await result.current.saveDraft({ name: 'x' }) })
      expect(uploadDocument).not.toHaveBeenCalled()
    })

    it('a COMPANY flow never holds anything: it sends at once, exactly as before', async () => {
      uploadDocument.mockResolvedValue({ document_id: 1, status: 'needs_review' })
      const { result } = hook(null, 'company')
      await act(async () => { result.current.chooseDocumentFiles([pdf]) })
      expect(result.current.draft).toBeNull()
      expect(uploadDocument).toHaveBeenCalledWith(pdf, false, 'en', { docTypeHint: null, visibility: 'company' })
    })
  })

  describe('defaultPersonalName', () => {
    it('is the file name without its last extension, trimmed and cut to 120 characters', () => {
      expect(defaultPersonalName('IMG_0042.jpg')).toBe('IMG_0042')
      expect(defaultPersonalName('lease.final.pdf')).toBe('lease.final')
      expect(defaultPersonalName('no-extension')).toBe('no-extension')
      expect(defaultPersonalName('  spaced  .png')).toBe('spaced')
      expect(defaultPersonalName('x'.repeat(200) + '.pdf')).toHaveLength(120)
    })

    it('never returns an empty name: a file that is all extension keeps its whole name', () => {
      expect(defaultPersonalName('.hidden')).toBe('.hidden')
    })
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

describe('a company picture carries the date it was taken (round 7, S1e, DECISIONS #138)', () => {
  it('reads the date from the ORIGINAL file (before the canvas re-encode drops it) and sends it as takenOn', async () => {
    vi.mocked(readExifDate).mockResolvedValueOnce('2024-02-05')
    uploadDocument.mockResolvedValue({ document_id: 1, status: 'needs_review' })
    const original = jpg('room.jpg')
    const { result } = hook()

    await act(async () => { result.current.uploadPhoto(original) })

    expect(readExifDate).toHaveBeenCalledWith(original)
    expect(uploadDocument).toHaveBeenCalledWith(expect.any(File), true, 'en', expect.objectContaining({ takenOn: '2024-02-05' }))
  })

  it('a picture with no date sends no takenOn', async () => {
    vi.mocked(readExifDate).mockResolvedValueOnce(null)
    uploadDocument.mockResolvedValue({ document_id: 1, status: 'needs_review' })
    const { result } = hook()

    await act(async () => { result.current.uploadPhoto(jpg('room.jpg')) })

    expect(uploadDocument.mock.calls[0]![3]!.takenOn).toBeUndefined()
  })

  it('a document is never read for a date', async () => {
    uploadDocument.mockResolvedValue({ document_id: 1, status: 'needs_review' })
    const { result } = hook()

    await act(async () => { result.current.chooseDocumentFiles([pdf]) })

    expect(readExifDate).not.toHaveBeenCalled()
    expect(uploadDocument.mock.calls[0]![3]!.takenOn).toBeUndefined()
  })
})
