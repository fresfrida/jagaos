/** The trace panel under the list keeps everything it had (real numbers: node, model, tokens, cost, decision) and only its label
 * changed, to "AI trace" (DECISIONS #110). */

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
  it('opens under the list with the new heading and the same real figures', async () => {
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
