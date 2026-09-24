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
  opsApi: { listPersonalFiles: vi.fn(), uploadDocument: vi.fn(), uploadPages: vi.fn(), getTrace: vi.fn(), editDocument: vi.fn(), archiveDocument: vi.fn() },
}))

import { opsApi, type DocumentRow } from '../features/ops/opsApi'
import { navigate } from '../router/navigate'
import { OnlyMePage } from './OnlyMePage'

const listPersonalFiles = vi.mocked(opsApi.listPersonalFiles)
const uploadDocument = vi.mocked(opsApi.uploadDocument)
const uploadPages = vi.mocked(opsApi.uploadPages)
const archiveDocument = vi.mocked(opsApi.archiveDocument)

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
  await i18n.changeLanguage('en')
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})
afterEach(cleanup)

describe('Only me: who reaches it', () => {
  it('a viewer, who cannot upload, is sent to the Calendar and nothing is fetched', async () => {
    auth.value = { status: 'signed-in', role: 'viewer' }
    render(<OnlyMePage />)
    await waitFor(() => expect(vi.mocked(navigate)).toHaveBeenCalledWith('/calendar'))
    expect(listPersonalFiles).not.toHaveBeenCalled()
    expect(screen.queryByTestId('document-input')).toBeNull()
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

  it.each(['user', 'admin', 'owner'])('a %s gets Delete on each of their own files', async (role) => {
    auth.value = { status: 'signed-in', role }
    render(<OnlyMePage />)
    await screen.findByText(LEASE)
    expect(screen.getAllByRole('button', { name: /^delete$/i })).toHaveLength(3)
  })

  it('confirming Delete archives that file and reloads the list without it', async () => {
    archiveDocument.mockResolvedValue({ status: 'archived' })
    render(<OnlyMePage />)
    await screen.findByText(LEASE)
    listPersonalFiles.mockResolvedValue(FILES.slice(1))

    fireEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]!)
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/Delete .*tenancy-agreement.*\? This can't be undone\./)).toBeTruthy()
    expect(archiveDocument).not.toHaveBeenCalled() // asking is not doing
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(archiveDocument).toHaveBeenCalledWith(1))
    await waitFor(() => expect(screen.queryByText(LEASE)).toBeNull())
    expect(screen.getByText(RECEIPT)).toBeTruthy()
    expect(screen.getByText('Your private files (2)')).toBeTruthy()
  })

  it('cancelling the confirmation deletes nothing', async () => {
    render(<OnlyMePage />)
    await screen.findByText(LEASE)

    fireEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]!)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))

    expect(archiveDocument).not.toHaveBeenCalled()
    expect(screen.getByText(LEASE)).toBeTruthy()
  })

  it('a refused delete shows the server message and keeps the file in the list', async () => {
    archiveDocument.mockRejectedValue(new Error('document not found'))
    render(<OnlyMePage />)
    await screen.findByText(LEASE)

    fireEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]!)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))

    expect((await screen.findByRole('alert')).textContent).toContain('document not found')
    expect(screen.getByText(LEASE)).toBeTruthy()
  })

  it('with none yet, says so, and shows no search box to search nothing', async () => {
    listPersonalFiles.mockResolvedValue([])
    render(<OnlyMePage />)
    expect(await screen.findByText(/Nothing here yet/)).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.getByText('Your private files (0)')).toBeTruthy()
  })

  it('a failed load is a visible error with a retry that loads again', async () => {
    listPersonalFiles.mockRejectedValueOnce(new Error('boom'))
    render(<OnlyMePage />)
    expect(await screen.findByText("Couldn't load your private files.")).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText(LEASE)).toBeTruthy()
    expect(screen.queryByText("Couldn't load your private files.")).toBeNull()
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
