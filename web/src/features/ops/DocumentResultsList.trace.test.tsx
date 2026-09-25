/** The trace panel keeps everything it had (real numbers: node, model, tokens, cost, decision) and only its label changed, to "AI trace"
 * (DECISIONS #110). Round 3, item 5 (DECISIONS #121): it opens directly under the card it was asked from, not after the whole list, and a
 * document with no recorded step gets a sentence, not a table with only a header. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

vi.mock('./opsApi', async (importActual) => ({
  ...(await importActual<typeof import('./opsApi')>()),
  opsApi: {
    getTrace: vi.fn(), archiveDocument: vi.fn(), requestPurge: vi.fn(),
    fetchDocumentThumbnail: vi.fn(() => new Promise(() => undefined)), fetchDocumentFile: vi.fn(() => new Promise(() => undefined)), // the card's thumbnail
  },
}))

import { DocumentResultsList } from './DocumentResultsList'
import { opsApi, type DocumentRow } from './opsApi'

const doc: DocumentRow = {
  id: 7, filename: 'invoice.pdf', media_type: 'application/pdf', lane: 'invoice', doc_type: 'invoice', status: 'filed', received_at: '2026-09-24 05:00:00',
  description: JSON.stringify({ en: 'A March invoice' }), bucket: 'Expenses', vendor_name: null, occurred_on: null, can_edit: true,
}
const REPORT = {
  total_cost_usd: 0.02646,
  nodes: [
    { node: 'classify', model: 'sonnet4.5', input_tokens: 1723, output_tokens: 227, cost_usd: 0.00857, decision: 'invoice/invoice' },
    { node: 'verify', model: null, input_tokens: null, output_tokens: null, cost_usd: null, decision: 'needs_review' },
  ],
}

beforeEach(async () => {
  vi.mocked(opsApi.getTrace).mockReset().mockResolvedValue(REPORT as never)
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

const open = async () => {
  render(<DocumentResultsList documents={[doc]} canEdit canArchive canRequestPurge={false} onSaved={vi.fn()} emptyMessage="none" />)
  fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'AI trace' }))
  await waitFor(() => expect(opsApi.getTrace).toHaveBeenCalledWith(7))
}

describe('the AI trace panel', () => {
  it('opens with the new heading and the same real figures', async () => {
    await open()
    expect((await screen.findByRole('heading', { level: 2 })).textContent).toBe('AI trace: document #7 · total $0.0265')
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Node', 'Model', 'Tokens in/out', 'Cost', 'Decision'])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows[0]!.textContent).toBe('classifysonnet4.51723 / 227$0.00857invoice/invoice')
    expect(rows[1]!.textContent).toBe('verify-- / --needs_review') // a node with no model, tokens or cost shows dashes, as before
  })

  it.each([
    ['zh', 'AI 追踪记录：文件 #7 · 总计 $0.0265'],
    ['ms', 'Jejak AI: dokumen #7 · jumlah $0.0265'],
    ['ta', 'AI தடமறிதல்: ஆவணம் #7 · மொத்தம் $0.0265'],
  ])('reads in %s', async (language, heading) => {
    await i18n.changeLanguage(language)
    render(<DocumentResultsList documents={[doc]} canEdit canArchive canRequestPurge={false} onSaved={vi.fn()} emptyMessage="none" />)
    fireEvent.click(screen.getAllByRole('button').find((b) => b.getAttribute('aria-haspopup') === 'menu')!)
    fireEvent.click(screen.getAllByRole('menuitem')[0]!)
    expect((await screen.findByRole('heading', { level: 2 })).textContent).toBe(heading)
  })
})

describe('the AI trace panel: where it opens and what an empty one says (round 3, item 5)', () => {
  const docs = [1, 2, 3, 4].map((id): DocumentRow => ({ ...doc, id, description: JSON.stringify({ en: `Doc ${id}` }) }))
  const openFor = async (documentId: number) => {
    const card = screen.getByText(`Doc ${documentId}`).closest('div.p-4') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /more actions/i }))
    fireEvent.click(within(card).getByRole('menuitem', { name: 'AI trace' }))
    await waitFor(() => expect(opsApi.getTrace).toHaveBeenCalledWith(documentId))
    return card
  }
  const showList = () =>
    render(<DocumentResultsList documents={docs} canEdit canArchive canRequestPurge={false} onSaved={vi.fn()} emptyMessage="none" />)

  it('opens directly under the card that asked for it, not at the bottom of a long list where it would look like nothing happened', async () => {
    showList()
    const card = await openFor(1)
    const panel = await screen.findByTestId('trace-panel')
    const cardWrapper = card.parentElement as HTMLElement
    expect(cardWrapper.nextElementSibling).toBe(panel) // right after the FIRST card
    expect(panel.nextElementSibling).toBe(screen.getByText('Doc 2').closest('div.p-4')!.parentElement) // and before the second
  })

  it('moves to another card when that card asks, and there is only ever one', async () => {
    showList()
    await openFor(1)
    await screen.findByTestId('trace-panel')
    const card = await openFor(3)
    await waitFor(() => expect(within(card.parentElement!.nextElementSibling as HTMLElement).getByRole('heading').textContent).toContain('document #3'))
    expect(screen.getAllByTestId('trace-panel')).toHaveLength(1)
  })

  it('brings itself into view, for a card near the bottom of the screen', async () => {
    const scrollIntoView = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      showList()
      await openFor(4)
      await screen.findByTestId('trace-panel')
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('says so when the pipeline recorded no step for the document, instead of a table with only a header', async () => {
    vi.mocked(opsApi.getTrace).mockResolvedValue({ nodes: [], total_cost_usd: 0 } as never)
    showList()
    await openFor(2)
    const panel = await screen.findByTestId('trace-panel')
    expect(within(panel).getByText('No AI steps were recorded for this document.')).toBeTruthy()
    expect(within(panel).queryByRole('table')).toBeNull()
    expect(within(panel).getByRole('heading').textContent).toBe('AI trace: document #2 · total $0.0000')
  })
})
