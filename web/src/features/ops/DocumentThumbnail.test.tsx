/** A PDF's card shows its first page (round 20, item 5, DECISIONS #97); a photo's card shows a small thumbnail, never the whole file (round 7, S1e stage 1, DECISIONS #138). */

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./opsApi', async (importActual) => ({
  ...(await importActual<typeof import('./opsApi')>()),
  opsApi: { fetchDocumentFile: vi.fn(), fetchDocumentThumbnail: vi.fn() },
}))

import { DocumentThumbnail } from './DocumentCard'
import { opsApi } from './opsApi'

const file = vi.mocked(opsApi.fetchDocumentFile)
const thumbnail = vi.mocked(opsApi.fetchDocumentThumbnail)
const jpeg = new Blob(['x'], { type: 'image/jpeg' })

beforeEach(() => {
  vi.resetAllMocks()
  URL.createObjectURL = vi.fn(() => 'blob:first-page')
  URL.revokeObjectURL = vi.fn()
})
afterEach(cleanup)

const icon = (container: HTMLElement) => container.querySelector('svg.lucide-file-text')

describe('DocumentThumbnail', () => {
  it('a PDF asks for its thumbnail, not the whole file, and shows the picture when it arrives', async () => {
    thumbnail.mockResolvedValue(jpeg)
    const { container } = render(<DocumentThumbnail documentId={7} mediaType="application/pdf" />)

    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:first-page'))
    expect(thumbnail).toHaveBeenCalledWith(7)
    expect(file).not.toHaveBeenCalled()
    expect(icon(container)).toBeNull()
    expect(container.querySelector('img')?.className).toContain('object-top') // a page is cropped from its top
  })

  it('shows the generic icon while the thumbnail is on its way', () => {
    thumbnail.mockReturnValue(new Promise(() => undefined))
    const { container } = render(<DocumentThumbnail documentId={7} mediaType="application/pdf" />)
    expect(icon(container)).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('keeps the generic icon when there is no thumbnail (not renderable, or not the caller\'s to see)', async () => {
    thumbnail.mockRejectedValue(new Error('404 Not Found'))
    const { container } = render(<DocumentThumbnail documentId={7} mediaType="application/pdf" />)

    await waitFor(() => expect(thumbnail).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(icon(container)).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('an image asks for its THUMBNAIL, never the whole file, and shows it when it arrives', async () => {
    thumbnail.mockResolvedValue(jpeg)
    const { container } = render(<DocumentThumbnail documentId={8} mediaType="image/jpeg" />)

    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:first-page'))
    expect(thumbnail).toHaveBeenCalledWith(8)
    expect(file).not.toHaveBeenCalled()
    expect(icon(container)).toBeNull()
    expect(container.querySelector('img')?.className).not.toContain('object-top')   // a photo is centred, only a page is cropped from its top
  })

  it('an image shows its frame (no icon) while the thumbnail is on its way', () => {
    thumbnail.mockReturnValue(new Promise(() => undefined))
    const { container } = render(<DocumentThumbnail documentId={8} mediaType="image/png" />)
    expect(icon(container)).toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('an image whose thumbnail fails (404: corrupt, unsupported, or not the caller\'s to see) falls back to the generic icon, and never asks for the file', async () => {
    thumbnail.mockRejectedValue(new Error('404 Not Found'))
    const { container } = render(<DocumentThumbnail documentId={8} mediaType="image/jpeg" />)

    await waitFor(() => expect(icon(container)).not.toBeNull())
    expect(container.querySelector('img')).toBeNull()
    expect(file).not.toHaveBeenCalled()
  })

  it('a list of twelve photo cards makes twelve thumbnail requests and NO file request', async () => {
    thumbnail.mockResolvedValue(jpeg)
    render(<>{Array.from({ length: 12 }, (_, i) => <DocumentThumbnail key={i} documentId={100 + i} mediaType="image/jpeg" />)}</>)

    await waitFor(() => expect(thumbnail).toHaveBeenCalledTimes(12))
    expect(thumbnail.mock.calls.map((c) => c[0])).toEqual(Array.from({ length: 12 }, (_, i) => 100 + i))
    expect(file).not.toHaveBeenCalled()
  })

  it('any other type gets the icon and makes no request at all', () => {
    const { container } = render(<DocumentThumbnail documentId={9} mediaType="text/plain" />)
    expect(icon(container)).not.toBeNull()
    expect(file).not.toHaveBeenCalled()
    expect(thumbnail).not.toHaveBeenCalled()
  })

  it('releases the picture when the card goes away', async () => {
    thumbnail.mockResolvedValue(jpeg)
    const { container, unmount } = render(<DocumentThumbnail documentId={7} mediaType="application/pdf" />)
    await waitFor(() => expect(container.querySelector('img')).not.toBeNull())

    unmount()

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first-page')
  })
})
