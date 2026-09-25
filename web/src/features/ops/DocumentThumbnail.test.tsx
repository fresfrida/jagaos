/** A PDF's card shows its first page (round 20, item 5, DECISIONS #97). */

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

  it('an image still shows the real file, as before', async () => {
    file.mockResolvedValue(jpeg)
    const { container } = render(<DocumentThumbnail documentId={8} mediaType="image/jpeg" />)

    await waitFor(() => expect(container.querySelector('img')).not.toBeNull())
    expect(file).toHaveBeenCalledWith(8)
    expect(thumbnail).not.toHaveBeenCalled()
    expect(container.querySelector('img')?.className).not.toContain('object-top')
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
