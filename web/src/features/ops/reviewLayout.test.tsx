/** Round 16, items 4 and 5, in the review card: the source image opens the same
 * viewer as everywhere else (no raw new-tab link), and the bucket and doc-type
 * pills are a fixed three-column grid that cuts a long word instead of reflowing. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

vi.mock('./opsApi', async (importActual) => ({
  ...(await importActual<typeof import('./opsApi')>()),
  opsApi: { fetchDocumentFile: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' })), resolveReview: vi.fn(), editDocument: vi.fn() },
}))

import { BucketField, DocTypeField, FieldLabelText } from './opsShared'
import { ReviewQueueCard } from './ReviewQueueCard'
import type { ReviewItem } from './opsApi'

const item = (over: Partial<ReviewItem> = {}): ReviewItem => ({
  id: 5, document_id: 42, document_filename: 'receipt-photo.jpg', document_media_type: 'image/jpeg', document_description: null,
  document_bucket: 'Expenses', document_lane: 'invoice', document_doc_type: 'receipt', document_vendor_name: null,
  thread_id: 't', reason: 'clean', question: '[]', proposed_json: '{}', status: 'open', ...over,
})

beforeEach(async () => {
  await i18n.changeLanguage('en')
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})
afterEach(cleanup)

const renderCard = (over: Partial<ReviewItem> = {}) =>
  render(<ReviewQueueCard item={item(over)} canResolve onResolved={vi.fn()} onRejected={vi.fn()} onPoll={vi.fn()} />)

describe('review card source preview (item 4)', () => {
  it('opens the shared viewer when the image is tapped, with no new-tab link anywhere', async () => {
    const { container } = renderCard()
    const image = await screen.findByRole('button', { name: 'Open the full-size image' })
    expect(container.querySelectorAll('a[target="_blank"]')).toHaveLength(0)

    fireEvent.click(image)

    const viewer = screen.getByRole('dialog', { name: /receipt-photo\.jpg/ })
    expect(within(viewer).getByRole('button', { name: 'Close preview' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a PDF preview also opens the viewer instead of a raw blob link', async () => {
    const { container } = renderCard({ document_media_type: 'application/pdf', document_filename: 'bill.pdf' })
    const open = await screen.findByRole('button', { name: 'Open source PDF' })
    expect(container.querySelectorAll('a[target="_blank"]')).toHaveLength(0)

    fireEvent.click(open)

    expect(screen.getByRole('dialog', { name: /bill\.pdf/ })).toBeTruthy()
  })
})

describe('review card source preview on a browser with no PDF viewer (round 3, item 1)', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'pdfViewerEnabled')
  })

  it('a PDF shows no inline preview and fetches nothing up front, only the button that opens the viewer', async () => {
    Object.defineProperty(navigator, 'pdfViewerEnabled', { value: false, configurable: true })
    const { opsApi } = await import('./opsApi')
    vi.mocked(opsApi.fetchDocumentFile).mockClear()

    const { container } = renderCard({ document_media_type: 'application/pdf', document_filename: 'bill.pdf' })

    expect(await screen.findByRole('button', { name: 'Open source PDF' })).toBeTruthy()
    expect(container.querySelector('embed')).toBeNull()
    expect(opsApi.fetchDocumentFile).not.toHaveBeenCalled()
  })

  it('a photo keeps its inline preview on the same browser', async () => {
    Object.defineProperty(navigator, 'pdfViewerEnabled', { value: false, configurable: true })
    renderCard()
    expect(await screen.findByRole('button', { name: 'Open the full-size image' })).toBeTruthy()
  })
})

describe('pill pickers (item 5)', () => {
  it('bucket pills are a fixed three-column grid, each cell cut with an ellipsis and carrying its full text as a tooltip', () => {
    render(<BucketField value="Expenses" disabled={false} onChange={vi.fn()} clearLabel="None" />)
    const group = screen.getByRole('group')
    expect(group.className).toContain('grid-cols-3')
    expect(group.className).not.toContain('flex-wrap')
    for (const pill of within(group).getAllByRole('button')) {
      expect(pill.className).toContain('truncate')
      expect(pill.className).toContain('min-w-0')
      expect(pill.getAttribute('title')).toBe(pill.textContent)
    }
  })

  it('the doc-type pills use the same grid', () => {
    render(<DocTypeField lane="invoice" value="invoice" disabled={false} onChange={vi.fn()} className="" />)
    expect(screen.getByRole('group').className).toContain('grid-cols-3')
  })

  it('a field label always reserves two lines and is clamped to them', () => {
    render(<FieldLabelText>Vendor name</FieldLabelText>)
    const label = screen.getByText('Vendor name')
    expect(label.className).toContain('h-8')
    expect(label.className).toContain('line-clamp-2')
    expect(label.className).toContain('overflow-hidden')
  })

  it('the review form uses the reserved-height label for every field', () => {
    renderCard({ proposed_json: JSON.stringify({ invoice_no: { value: 'INV-1', confidence: 0.9 }, total: { value: 10, confidence: 0.9 } }) })
    for (const text of ['Filename', 'Description', 'Bucket', 'Doc type', 'Vendor name', 'Invoice no.']) {
      const el = screen.queryByText(text)
      if (el) expect(el.className, text).toContain('h-8')
    }
    expect(screen.getByText('Filename').className).toContain('h-8')
    expect(screen.getByText('Bucket').className).toContain('h-8')
  })
})
