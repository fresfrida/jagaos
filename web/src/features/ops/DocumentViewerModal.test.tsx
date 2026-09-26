/** A PDF on a browser with no PDF viewer of its own (Android Chrome and Brave) is DOWNLOADED, not drawn: round 3 (DECISIONS #121) stopped
 * the `<embed>` (which there shows the browser's own "cannot preview" box named by a UUID) and round 4 (DECISIONS #122) replaced its blob
 * hand-off, which never worked on a real phone, with a server-made, single-use download link. One explicit tap; nothing starts by itself.
 * Desktop and images are unchanged. `navigator.pdfViewerEnabled` tells the two kinds of browser apart (lib/pdfSupport.ts). */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

vi.mock('./opsApi', async (importActual) => ({
  ...(await importActual<typeof import('./opsApi')>()),
  opsApi: { fetchDocumentFile: vi.fn(), fetchDocumentThumbnail: vi.fn(), createDownloadLink: vi.fn() },
}))
vi.mock('../../lib/download', () => ({ startDownload: vi.fn() }))

import { startDownload } from '../../lib/download'
import { DocumentViewerModal } from './DocumentCard'
import { opsApi } from './opsApi'

const fetchFile = vi.mocked(opsApi.fetchDocumentFile)
const makeLink = vi.mocked(opsApi.createDownloadLink)
const setViewer = (value: boolean | undefined) => Object.defineProperty(navigator, 'pdfViewerEnabled', { value, configurable: true })

beforeEach(async () => {
  vi.resetAllMocks()
  await i18n.changeLanguage('en')
  URL.createObjectURL = vi.fn(() => 'blob:the-file')
  URL.revokeObjectURL = vi.fn()
  fetchFile.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }))
  makeLink.mockResolvedValue({ url: '/api/documents/9/download?token=abc', expires_in: 60 })
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'pdfViewerEnabled')
})

const show = (over: Partial<{ filename: string; media_type: string }> = {}) =>
  render(<DocumentViewerModal doc={{ id: 9, filename: '01_certificate_of_incorporation.pdf', media_type: 'application/pdf', ...over }} onClose={vi.fn()} />)

describe('DocumentViewerModal, a PDF where the browser has a PDF viewer (desktop)', () => {
  it('draws it inline, as before, and asks for no download link', async () => {
    setViewer(true)
    const { container } = show()

    await waitFor(() => expect(container.querySelector('embed')?.getAttribute('src')).toBe('blob:the-file'))
    expect(screen.queryByRole('button', { name: 'Download PDF' })).toBeNull()
    expect(makeLink).not.toHaveBeenCalled()
    expect(startDownload).not.toHaveBeenCalled()
  })

  it('a browser too old to say is treated the same, so nothing changes for it', async () => {
    setViewer(undefined)
    const { container } = show()
    await waitFor(() => expect(container.querySelector('embed')).not.toBeNull())
    expect(makeLink).not.toHaveBeenCalled()
  })
})

describe('DocumentViewerModal, a PDF where the browser has no PDF viewer (a phone)', () => {
  it('draws no embed, fetches no bytes, and offers ONE button; nothing starts by itself', async () => {
    setViewer(false)
    const { container } = show()

    expect(container.querySelector('embed')).toBeNull()
    const button = await screen.findByRole('button', { name: 'Download PDF' })
    expect(screen.getByText("This browser can't show a PDF inside the page. Download it to open it on your device.")).toBeTruthy()
    await Promise.resolve()

    expect(fetchFile).not.toHaveBeenCalled() // the whole file is not pulled into memory for a download that will not use it
    expect(makeLink).not.toHaveBeenCalled() // no automatic attempt: a link is asked for on the tap, so it cannot expire unused
    expect(startDownload).not.toHaveBeenCalled()
    expect(button.getAttribute('href')).toBeNull() // a real button, not a blob: link
    expect(screen.queryByText(/if nothing happens/i)).toBeNull() // there is no first attempt to explain
    expect(container.querySelector('a[download]')).toBeNull()
    expect(container.querySelector('a[href^="blob:"]')).toBeNull()
  })

  it('a tap asks the server for a link for THAT document and follows it, with the API address in front', async () => {
    setViewer(false)
    show()

    fireEvent.click(await screen.findByRole('button', { name: 'Download PDF' }))

    await waitFor(() => expect(startDownload).toHaveBeenCalledTimes(1))
    expect(makeLink).toHaveBeenCalledWith(9)
    // API_BASE_URL is empty in the test build, so the relative URL comes through as is; on the box it is the same origin, on Vercel the box's address.
    expect(vi.mocked(startDownload).mock.calls[0]![0]).toMatch(/\/api\/documents\/9\/download\?token=abc$/)
  })

  it('says it is preparing while the link is being made, and cannot be tapped twice', async () => {
    setViewer(false)
    let release: () => void = () => undefined
    makeLink.mockReturnValue(new Promise((resolve) => { release = () => resolve({ url: '/api/documents/9/download?token=abc', expires_in: 60 }) }))
    show()

    fireEvent.click(await screen.findByRole('button', { name: 'Download PDF' }))

    const busy = await screen.findByRole('button', { name: 'Preparing your download…' })
    expect((busy as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(busy)
    expect(makeLink).toHaveBeenCalledTimes(1)
    release()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download PDF' })).toBeTruthy())
  })

  it('shows the failure and lets the person tap again, without following anything', async () => {
    setViewer(false)
    makeLink.mockRejectedValueOnce(new Error('404'))
    show()

    fireEvent.click(await screen.findByRole('button', { name: 'Download PDF' }))

    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't prepare the download. Try again.")
    expect(startDownload).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' })) // the second try works
    await waitFor(() => expect(startDownload).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reads in the chosen language', async () => {
    setViewer(false)
    await i18n.changeLanguage('ms')
    show()
    expect(await screen.findByRole('button', { name: 'Muat turun PDF' })).toBeTruthy()
  })

  it('leaves an image alone: it renders in an <img> everywhere, with no download button', async () => {
    setViewer(false)
    fetchFile.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }))
    const { container } = show({ filename: 'receipt.jpg', media_type: 'image/jpeg' })
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:the-file'))
    expect(screen.queryByRole('button', { name: 'Download PDF' })).toBeNull()
    expect(makeLink).not.toHaveBeenCalled()
  })
})


describe('DocumentViewerModal, a photo (round 7, S1e stage 1, DECISIONS #138)', () => {
  it('is the ONLY place the full file of a photo is fetched: opening the viewer asks for the file, and not for a thumbnail', async () => {
    fetchFile.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }))
    show({ filename: 'holiday.jpg', media_type: 'image/jpeg' })
    await waitFor(() => expect(fetchFile).toHaveBeenCalledWith(9))
    expect(vi.mocked(opsApi.fetchDocumentThumbnail)).not.toHaveBeenCalled()
  })
})
