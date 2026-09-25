/** The Only me page (round 19, DECISIONS #94): the person's private files, the same
 * two-row upload area sent as private, and the section's own instant search. */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const auth = vi.hoisted(() => ({ value: { status: 'signed-in', role: 'user' } as { status: string; role: string | null } }))
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => auth.value }))
vi.mock('../router/navigate', () => ({ navigate: vi.fn() }))
vi.mock('../lib/imageNormalize', () => ({ normalizeImageForUpload: vi.fn(async (f: File) => f) }))
vi.mock('../features/ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../features/ops/opsApi')>()),
  opsApi: { listPersonalFiles: vi.fn(), uploadDocument: vi.fn(), uploadPages: vi.fn(), getTrace: vi.fn(), editDocument: vi.fn(), archiveDocument: vi.fn(), fetchDocumentThumbnail: vi.fn(), getLimits: vi.fn(), purgeDocument: vi.fn() },
}))

import { ApiError } from '../lib/apiClient'
import { resetFileLimitCache } from '../features/upload/fileLimit'
import { opsApi, type DocumentRow, type Limits } from '../features/ops/opsApi'
import { navigate } from '../router/navigate'
import { OnlyMePage } from './OnlyMePage'

const listPersonalFiles = vi.mocked(opsApi.listPersonalFiles)
const uploadDocument = vi.mocked(opsApi.uploadDocument)
const uploadPages = vi.mocked(opsApi.uploadPages)
const getLimits = vi.mocked(opsApi.getLimits)
const purgeDocument = vi.mocked(opsApi.purgeDocument)
const LIMITS: Limits = { max_file_bytes: 25 * 1024 * 1024, max_personal_files: 15, personal_files_used: 3 }

const row = (id: number, over: Partial<DocumentRow> = {}): DocumentRow => ({
  id, filename: `file-${id}.pdf`, media_type: 'application/pdf', lane: 'invoice', doc_type: 'invoice', status: 'filed',
  received_at: '2026-09-25 05:00:00', description: null, bucket: null, vendor_name: null, occurred_on: null, visibility: 'only_me', can_edit: true, ...over,
})
const FILES = [
  row(1, { filename: 'tenancy-agreement.pdf', description: JSON.stringify({ en: 'My flat lease' }) }),
  row(2, { filename: 'medical-receipt.pdf', description: JSON.stringify({ en: 'Clinic receipt' }), vendor_name: 'Klinik Sihat' }),
  row(3, { filename: 'notes.pdf', description: JSON.stringify({ en: 'Loose notes' }) }),
]
// A card is titled by its description, not its filename (DECISIONS #52), so these are what shows.
const LEASE = 'My flat lease'
const RECEIPT = 'Clinic receipt'
const NOTES = 'Loose notes'

const pdf = new File(['%PDF'], 'secret.pdf', { type: 'application/pdf' })
const searchBox = () => screen.getByRole('searchbox', { name: 'Search your private files' })

beforeEach(async () => {
  vi.resetAllMocks()
  auth.value = { status: 'signed-in', role: 'user' }
  listPersonalFiles.mockResolvedValue(FILES)
  vi.mocked(opsApi.fetchDocumentThumbnail).mockRejectedValue(new Error('404')) // a PDF card asks for its first page; none here
  getLimits.mockResolvedValue(LIMITS)
  resetFileLimitCache()
  await i18n.changeLanguage('en')
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})
afterEach(cleanup)

describe('Only me: who reaches it', () => {
  it('a viewer gets the page too, read-only: no redirect, no upload rows, no scratchpad, no Delete or Edit', async () => {
    auth.value = { status: 'signed-in', role: 'viewer' }
    listPersonalFiles.mockResolvedValue(FILES)
    render(<OnlyMePage />)

    expect(await screen.findByText(LEASE)).toBeTruthy() // files they had before a role change are listed
    expect(vi.mocked(navigate)).not.toHaveBeenCalled()
    expect(listPersonalFiles).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('document-input')).toBeNull()
    expect(screen.queryByTestId('photo-input')).toBeNull()
    expect(screen.queryByRole('button', { name: /scratchpad/i })).toBeNull()
    expect(screen.queryByTestId('only-me-limits-note')).toBeNull()
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBeNull()
  })

  it('a viewer with no files sees a sentence about what they CAN do, not an invitation to add one', async () => {
    auth.value = { status: 'signed-in', role: 'viewer' }
    listPersonalFiles.mockResolvedValue([])
    render(<OnlyMePage />)

    expect(await screen.findByText('Nothing here yet. You can still browse Calendar, Search and Company Files from the nav.')).toBeTruthy()
    expect(screen.queryByText(/Add a document or a photo above/)).toBeNull() // no invitation to add one
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it.each(['user', 'admin', 'owner'])('a %s gets the page with the upload area and their files', async (role) => {
    auth.value = { status: 'signed-in', role }
    render(<OnlyMePage />)
    expect(await screen.findByText(LEASE)).toBeTruthy()
    expect(screen.getByTestId('document-input')).toBeTruthy()
    expect(screen.getByTestId('photo-input')).toBeTruthy()
  })
})

describe('Only me: the files', () => {
  it('shows the person\'s private files with a count', async () => {
    render(<OnlyMePage />)
    expect(await screen.findByText(LEASE)).toBeTruthy()
    expect(screen.getByText(RECEIPT)).toBeTruthy()
    expect(screen.getByText('Your private files (3)')).toBeTruthy()
  })

  it('says what the limits are and how many of the slots this person has used', async () => {
    render(<OnlyMePage />)
    await screen.findByText(LEASE)
    await waitFor(() => expect(screen.getByTestId('only-me-limits-note').textContent).toBe('Up to 15 private files, 25 MB each. You have 3.'))
  })

  it('says nothing about limits against a backend that has none, rather than something it cannot back up', async () => {
    getLimits.mockRejectedValue(new ApiError(404, 'Not Found'))
    render(<OnlyMePage />)
    await screen.findByText(LEASE)
    await waitFor(() => expect(getLimits).toHaveBeenCalled())
    await Promise.resolve()
    expect(screen.queryByTestId('only-me-limits-note')).toBeNull()
  })

  it('at the limit it says so, and turns the Document and Photo rows and the scratchpad off', async () => {
    getLimits.mockResolvedValue({ ...LIMITS, personal_files_used: 15 })
    render(<OnlyMePage />)
    await screen.findByText(LEASE)

    await waitFor(() => expect(screen.getByTestId('only-me-limits-note').textContent).toBe('You have reached the limit of 15 private files. Delete one to add another.'))
    for (const name of [/^document/i, /^photo/i, /scratchpad/i]) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('just under the limit everything is still on', async () => {
    getLimits.mockResolvedValue({ ...LIMITS, personal_files_used: 14 })
    render(<OnlyMePage />)
    await screen.findByText(LEASE)
    await waitFor(() => expect(screen.getByTestId('only-me-limits-note').textContent).toContain('You have 14'))
    expect((screen.getByRole('button', { name: /^document/i }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a viewer, who has no allowance, does not fetch the limits', async () => {
    auth.value = { status: 'signed-in', role: 'viewer' }
    render(<OnlyMePage />)
    await screen.findByText(LEASE)
    expect(getLimits).not.toHaveBeenCalled()
  })

  it.each(['user', 'admin', 'owner'])('a %s gets Delete on each of their own files', async (role) => {
    auth.value = { status: 'signed-in', role }
    render(<OnlyMePage />)
    await screen.findByText(LEASE)
    expect(screen.getAllByRole('button', { name: /^delete$/i })).toHaveLength(3)
  })

  const openDelete = (index = 0) => fireEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[index]!)
  const confirmButton = () => within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete for good' }) as HTMLButtonElement
  const typeName = (value: string) => fireEvent.change(within(screen.getByRole('alertdialog')).getByLabelText('File name'), { target: { value } })

  it('Delete asks for the file\'s name, deletes FOR GOOD once it is typed, and reloads the list and the count', async () => {
    purgeDocument.mockResolvedValue({ status: 'purged', file_removed: true })
    render(<OnlyMePage />)
    await screen.findByText(LEASE)
    listPersonalFiles.mockResolvedValue(FILES.slice(1))
    getLimits.mockResolvedValue({ ...LIMITS, personal_files_used: 2 })

    openDelete(0)
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/can't be undone/)).toBeTruthy()
    expect(within(dialog).getByTestId('typed-confirm-expected').textContent).toBe('tenancy-agreement.pdf')
    expect(confirmButton().disabled).toBe(true) // asking is not doing
    typeName('tenancy-agreement.pdf')
    expect(confirmButton().disabled).toBe(false)
    fireEvent.click(confirmButton())

    await waitFor(() => expect(purgeDocument).toHaveBeenCalledWith(1, 'tenancy-agreement.pdf'))
    await waitFor(() => expect(screen.queryByText(LEASE)).toBeNull())
    expect(screen.getByText('Your private files (2)')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('only-me-limits-note').textContent).toContain('You have 2'))
    expect(vi.mocked(opsApi.archiveDocument)).not.toHaveBeenCalled() // never a soft archive
  })

  it('the confirm button stays off for anything but the exact name', async () => {
    render(<OnlyMePage />)
    await screen.findByText(LEASE)
    openDelete(0)

    for (const wrong of ['', 'tenancy', 'Tenancy-Agreement.pdf', 'tenancy-agreement.pdf ', ' tenancy-agreement.pdf']) {
      typeName(wrong)
      expect(confirmButton().disabled, JSON.stringify(wrong)).toBe(true)
    }
    expect(purgeDocument).not.toHaveBeenCalled()
  })

  it('cancelling the confirmation deletes nothing, and the next time it opens empty', async () => {
    render(<OnlyMePage />)
    await screen.findByText(LEASE)
    openDelete(0)
    typeName('tenancy-agreement.pdf')

    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(purgeDocument).not.toHaveBeenCalled()
    expect(screen.getByText(LEASE)).toBeTruthy()

    openDelete(0)
    expect((within(screen.getByRole('alertdialog')).getByLabelText('File name') as HTMLInputElement).value).toBe('')
  })

  it('a refused delete shows the server message and keeps the file in the list', async () => {
    purgeDocument.mockRejectedValue(new Error('document not found'))
    render(<OnlyMePage />)
    await screen.findByText(LEASE)

    openDelete(0)
    typeName('tenancy-agreement.pdf')
    fireEvent.click(confirmButton())

    expect((await screen.findByRole('alert')).textContent).toContain('document not found')
    expect(screen.getByText(LEASE)).toBeTruthy()
  })

  it('an upload refused for size or for the limit is explained in the page\'s language, with the number', async () => {
    uploadDocument.mockRejectedValueOnce(new ApiError(413, 'That file is larger than the 25 MB limit.', 'file_too_large', { code: 'file_too_large', limit_bytes: 25 * 1024 * 1024 }))
    render(<OnlyMePage />)
    await screen.findByText(LEASE)

    await act(async () => { fireEvent.change(screen.getByTestId('document-input'), { target: { files: [pdf] } }) })
    expect((await screen.findByRole('alert')).textContent).toBe('That file is larger than the 25 MB limit.')

    uploadDocument.mockRejectedValueOnce(new ApiError(409, 'You already have 15 private files.', 'personal_file_limit', { code: 'personal_file_limit', limit: 15 }))
    await act(async () => { fireEvent.change(screen.getByTestId('document-input'), { target: { files: [pdf] } }) })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('You have reached the limit of 15 private files. Delete one to add another.'))
  })

  it('a file over the limit is refused in the browser before anything is sent', async () => {
    render(<OnlyMePage />)
    await screen.findByText(LEASE)
    const huge = new File(['x'], 'huge.pdf', { type: 'application/pdf' })
    Object.defineProperty(huge, 'size', { value: 25 * 1024 * 1024 + 1 })

    await act(async () => { fireEvent.change(screen.getByTestId('document-input'), { target: { files: [huge] } }) })

    expect((await screen.findByRole('alert')).textContent).toBe('That file is larger than the 25 MB limit.')
    expect(uploadDocument).not.toHaveBeenCalled()
  })

})

describe('Only me: the scoped search', () => {
  it('filters the list in place as they type, with a count, and never calls the server for it', async () => {
    render(<OnlyMePage />)
    await screen.findByText(LEASE)
    expect(listPersonalFiles).toHaveBeenCalledTimes(1)

    fireEvent.change(searchBox(), { target: { value: 'lease' } })

    expect(screen.getByText(LEASE)).toBeTruthy()
    expect(screen.queryByText(RECEIPT)).toBeNull()
    expect(screen.queryByText(NOTES)).toBeNull()
    expect(screen.getByTestId('only-me-search-count').textContent).toBe('1 of 3 match')
    expect(listPersonalFiles).toHaveBeenCalledTimes(1)
  })

  it('matches a vendor, and needs every word', async () => {
    render(<OnlyMePage />)
    await screen.findByText(LEASE)

    fireEvent.change(searchBox(), { target: { value: 'klinik receipt' } })
    expect(screen.getByText(RECEIPT)).toBeTruthy()
    expect(screen.queryByText(NOTES)).toBeNull()

    fireEvent.change(searchBox(), { target: { value: 'klinik lease' } })
    expect(screen.queryByText(RECEIPT)).toBeNull()
  })

  it('a search with no match says so and names the query, unlike the empty state', async () => {
    render(<OnlyMePage />)
    await screen.findByText(LEASE)

    fireEvent.change(searchBox(), { target: { value: 'zzz' } })

    expect(screen.getByText('No private file matches "zzz".')).toBeTruthy()
    expect(screen.queryByText(/Nothing here yet/)).toBeNull()
    expect(screen.getByTestId('only-me-search-count').textContent).toBe('0 of 3 match')
  })

  it('the clear button and Escape both bring every file back', async () => {
    render(<OnlyMePage />)
    await screen.findByText(LEASE)

    fireEvent.change(searchBox(), { target: { value: 'lease' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear the search' }))
    expect((searchBox() as HTMLInputElement).value).toBe('')
    expect(screen.getByText(NOTES)).toBeTruthy()
    expect(screen.queryByTestId('only-me-search-count')).toBeNull()

    fireEvent.change(searchBox(), { target: { value: 'lease' } })
    fireEvent.keyDown(searchBox(), { key: 'Escape' })
    expect((searchBox() as HTMLInputElement).value).toBe('')
    expect(screen.getByText(NOTES)).toBeTruthy()
  })

  it('finds a file by its bucket as the person reads it in their language', async () => {
    listPersonalFiles.mockResolvedValue([row(1, { filename: 'a.pdf', description: JSON.stringify({ en: 'Alpha doc' }), bucket: 'Expenses' }), row(2, { filename: 'b.pdf', description: JSON.stringify({ en: 'Beta doc' }), bucket: 'Compliance' })])
    await i18n.changeLanguage('ms')
    render(<OnlyMePage />)
    await screen.findByText('Alpha doc')
    const label = i18n.t('ops.bucket.expenses')

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: label } })

    expect(screen.getByText('Alpha doc')).toBeTruthy()
    expect(screen.queryByText('Beta doc')).toBeNull()
  })
})

describe('Only me: uploading', () => {
  it('a document is sent as private, then the list reloads and a toast says only they can see it', async () => {
    uploadDocument.mockResolvedValue({ document_id: 9, status: 'needs_review' })
    render(<OnlyMePage />)
    await screen.findByText(LEASE)

    await act(async () => { fireEvent.change(screen.getByTestId('document-input'), { target: { files: [pdf] } }) })

    expect(uploadDocument).toHaveBeenCalledWith(pdf, false, 'en', { docTypeHint: undefined, visibility: 'only_me' })
    await waitFor(() => expect(listPersonalFiles).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/Added to Only me/)).toBeTruthy()
  })

  it('a photo is sent as private too', async () => {
    uploadDocument.mockResolvedValue({ document_id: 9, status: 'needs_review' })
    render(<OnlyMePage />)
    await screen.findByText(LEASE)
    const photo = new File(['x'], 'me.jpg', { type: 'image/jpeg' })

    await act(async () => { fireEvent.change(screen.getByTestId('photo-input'), { target: { files: [photo] } }) })

    expect(uploadDocument).toHaveBeenCalledWith(photo, true, 'en', { docTypeHint: null, visibility: 'only_me' })
  })

  it('several pages of one document are sent as private together', async () => {
    uploadPages.mockResolvedValue({ document_id: 9, status: 'needs_review' })
    render(<OnlyMePage />)
    await screen.findByText(LEASE)
    const pages = [new File(['a'], 'p1.jpg', { type: 'image/jpeg' }), new File(['b'], 'p2.jpg', { type: 'image/jpeg' })]

    await act(async () => { fireEvent.change(screen.getByTestId('document-input'), { target: { files: pages } }) })
    fireEvent.click(await screen.findByRole('button', { name: /^upload/i }))

    await waitFor(() => expect(uploadPages).toHaveBeenCalledTimes(1))
    expect(uploadPages.mock.calls[0]?.[2]).toEqual({ docTypeHint: undefined, visibility: 'only_me' })
  })

  it('a duplicate is reported as one, not as a saved private file', async () => {
    uploadDocument.mockResolvedValue({ document_id: 1, status: 'duplicate' })
    render(<OnlyMePage />)
    await screen.findByText(LEASE)

    await act(async () => { fireEvent.change(screen.getByTestId('document-input'), { target: { files: [pdf] } }) })

    expect(await screen.findByText(i18n.t('ops.upload.toast.duplicate'))).toBeTruthy()
    expect(screen.queryByText(/Added to Only me/)).toBeNull()
  })

  it('a rejected upload shows its error and leaves the list alone', async () => {
    uploadDocument.mockRejectedValue(new Error('too big'))
    render(<OnlyMePage />)
    await screen.findByText(LEASE)

    await act(async () => { fireEvent.change(screen.getByTestId('document-input'), { target: { files: [pdf] } }) })

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/too big/)).toBeTruthy()
    expect(screen.getByText(LEASE)).toBeTruthy()
  })
})

describe('Only me: the scratchpad', () => {
  const ctx = { fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn() }
  beforeEach(() => {
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' })))
  })

  it('is a row that opens a pad, and the pad closes again', async () => {
    render(<OnlyMePage />)
    await screen.findByText(LEASE)
    expect(screen.queryByTestId('scratchpad-canvas')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /scratchpad/i }))
    expect(screen.getByTestId('scratchpad-canvas')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close the scratchpad' }))
    expect(screen.queryByTestId('scratchpad-canvas')).toBeNull()
  })

  it('saving uploads the drawing as a private photo, then the list reloads', async () => {
    uploadDocument.mockResolvedValue({ document_id: 9, status: 'needs_review' })
    render(<OnlyMePage />)
    await screen.findByText(LEASE)
    fireEvent.click(screen.getByRole('button', { name: /scratchpad/i }))
    const canvas = screen.getByTestId('scratchpad-canvas')
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 5, clientY: 5, pointerId: 1 })

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save as image' })) })

    await waitFor(() => expect(uploadDocument).toHaveBeenCalledTimes(1))
    const [file, isPicture, language, options] = uploadDocument.mock.calls[0] as unknown as [File, boolean, string, unknown]
    expect(file.type).toBe('image/png')
    expect(file.name).toMatch(/^scratchpad-\d{8}-\d{6}\.png$/)
    expect(isPicture).toBe(true)
    expect(language).toBe('en')
    expect(options).toEqual({ docTypeHint: null, visibility: 'only_me' })
    await waitFor(() => expect(listPersonalFiles).toHaveBeenCalledTimes(2))
  })
})
