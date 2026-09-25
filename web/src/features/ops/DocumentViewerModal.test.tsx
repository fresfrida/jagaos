/** Round 3, item 1 (DECISIONS #121): a PDF on a browser with no PDF viewer of its own (Android Chrome and Brave) is handed to the device
 * under its real name instead of drawn in an `<embed>`, which there shows the browser's own "cannot preview" box named by the blob's UUID.
 * Desktop and images are unchanged. `navigator.pdfViewerEnabled` is what tells the two browsers apart (lib/pdfSupport.ts). */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

vi.mock('./opsApi', async (importActual) => ({
  ...(await importActual<typeof import('./opsApi')>()),
  opsApi: { fetchDocumentFile: vi.fn(), fetchDocumentThumbnail: vi.fn() },
}))

import { DocumentViewerModal } from './DocumentCard'
import { opsApi } from './opsApi'

const fetchFile = vi.mocked(opsApi.fetchDocumentFile)
const setViewer = (value: boolean | undefined) => Object.defineProperty(navigator, 'pdfViewerEnabled', { value, configurable: true })
let clicks: HTMLAnchorElement[]

beforeEach(async () => {
  vi.resetAllMocks()
  await i18n.changeLanguage('en')
  URL.createObjectURL = vi.fn(() => 'blob:the-file')
  URL.revokeObjectURL = vi.fn()
  fetchFile.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }))
  clicks = []
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push(this) // jsdom would try to navigate to a blob: URL
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'pdfViewerEnabled')
})

const show = (over: Partial<{ filename: string; media_type: string }> = {}) =>
  render(<DocumentViewerModal doc={{ id: 9, filename: '01_certificate_of_incorporation.pdf', media_type: 'application/pdf', ...over }} onClose={vi.fn()} />)

describe('DocumentViewerModal, a PDF where the browser has a PDF viewer (desktop)', () => {
  it('draws it inline, as before, and starts no download', async () => {
    setViewer(true)
    const { container } = show()

    await waitFor(() => expect(container.querySelector('embed')?.getAttribute('src')).toBe('blob:the-file'))
    expect(screen.queryByRole('link', { name: 'Open PDF' })).toBeNull()
    expect(clicks).toHaveLength(0)
  })

  it('a browser too old to say is treated the same, so nothing changes for it', async () => {
    setViewer(undefined)
    const { container } = show()
    await waitFor(() => expect(container.querySelector('embed')).not.toBeNull())
    expect(clicks).toHaveLength(0)
  })
})

describe('DocumentViewerModal, a PDF where the browser has no PDF viewer (a phone)', () => {
  it('never draws the embed, and hands the file over under its real name the moment it is ready, once', async () => {
    setViewer(false)
    const { container, rerender } = show()

    expect(container.querySelector('embed')).toBeNull()
    expect(screen.getByText('Loading source…')).toBeTruthy() // nothing to click until the bytes are here
    const link = await screen.findByRole('link', { name: 'Open PDF' })

    expect(link.getAttribute('href')).toBe('blob:the-file')
    expect(link.getAttribute('download')).toBe('01_certificate_of_incorporation.pdf') // the real name, not the blob's UUID
    expect(container.querySelector('embed')).toBeNull()
    expect(clicks).toEqual([link]) // one tap: the download was started for the person
    expect(screen.getByText(/can't show a PDF inside the page/)).toBeTruthy()

    rerender(<DocumentViewerModal doc={{ id: 9, filename: '01_certificate_of_incorporation.pdf', media_type: 'application/pdf' }} onClose={vi.fn()} />)
    expect(clicks).toHaveLength(1) // a re-render does not start it again
  })

  it('keeps the link on screen as the fallback, so a browser that holds the automatic download back still works with one more tap', async () => {
    setViewer(false)
    show()
    const link = await screen.findByRole('link', { name: 'Open PDF' })
    link.addEventListener('click', (e) => e.preventDefault()) // jsdom cannot navigate to a blob: URL
    fireEvent.click(link)
    expect(clicks.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('link', { name: 'Open PDF' })).toBeTruthy()
  })

  it('gives a PDF a person named without an extension the .pdf a phone needs', async () => {
    setViewer(false)
    show({ filename: 'Lease' })
    expect((await screen.findByRole('link', { name: 'Open PDF' })).getAttribute('download')).toBe('Lease.pdf')
  })

  it('shows the same failure message as ever when the file cannot be loaded, and offers no link', async () => {
    setViewer(false)
    fetchFile.mockRejectedValue(new Error('404'))
    show()
    expect(await screen.findByText("Couldn't load the source file.")).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open PDF' })).toBeNull()
    expect(clicks).toHaveLength(0)
  })

  it('leaves an image alone: it renders in an <img> everywhere', async () => {
    setViewer(false)
    fetchFile.mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }))
    const { container } = show({ filename: 'receipt.jpg', media_type: 'image/jpeg' })
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:the-file'))
    expect(screen.queryByRole('link', { name: 'Open PDF' })).toBeNull()
    expect(clicks).toHaveLength(0)
  })
})
