/** AI trace, redesigned around credibility, not a log dump (round 5, items 3 and 6, DECISIONS #125; originally
 * DECISIONS #110/#121). It is now a per-card accordion DocumentCard owns itself — no "···" menu, no sibling panel a
 * parent list renders after the card — with a collapsed "AI trace · N steps · $X" summary that needs no fetch (it
 * rides on `doc.trace_summary`, already on the list response) and the full detail fetched lazily, once, only when
 * opened. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

vi.mock('./opsApi', async (importActual) => ({
  ...(await importActual<typeof import('./opsApi')>()),
  opsApi: {
    getTrace: vi.fn(),
    fetchDocumentThumbnail: vi.fn(() => new Promise(() => undefined)),
    fetchDocumentFile: vi.fn(() => new Promise(() => undefined)),
  },
}))

import { DocumentCard } from './DocumentCard'
import { opsApi, type DocumentRow, type TraceReport } from './opsApi'

const doc = (over: Partial<DocumentRow> = {}): DocumentRow => ({
  id: 7, filename: 'invoice.pdf', media_type: 'application/pdf', lane: 'invoice', doc_type: 'invoice', status: 'filed',
  received_at: '2026-09-24 05:00:00', description: JSON.stringify({ en: 'A March invoice' }), bucket: 'Expenses',
  vendor_name: null, occurred_on: null, can_edit: true, trace_summary: { steps: 2, cost_usd: 0.02646 }, ...over,
})

const REPORT: TraceReport = {
  total_cost_usd: 0.02646,
  nodes: [
    { node: 'classify', model: 'sonnet4.5', input_tokens: 1723, output_tokens: 227, cost_usd: 0.00857, latency_ms: 900, decision: 'invoice/invoice', at: '2026-09-24 05:00:01' },
    { node: 'rules.transition_document', model: null, input_tokens: null, output_tokens: null, cost_usd: null, latency_ms: null, decision: 'needs_review->filed by owner@x.test', at: '2026-09-24 05:00:02' },
  ],
  extraction: [
    { field: 'vendor', value_text: 'Acme Engineering', value_num: null, value_date: null, confidence: 0.95, source: 'llm' },
    { field: 'total', value_text: null, value_num: 436, value_date: null, confidence: 0.9, source: 'human' },
  ],
}

const show = (d: DocumentRow = doc()) =>
  render(<DocumentCard doc={d} canEdit canArchive onView={vi.fn()} onArchive={vi.fn()} onSaved={vi.fn()} />)

beforeEach(async () => {
  vi.mocked(opsApi.getTrace).mockReset().mockResolvedValue(REPORT)
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('the collapsed summary', () => {
  it('shows the step count and cost from doc.trace_summary, with no fetch at all until opened', () => {
    show()
    expect(screen.getByRole('button', { name: 'AI trace · 2 steps · $0.0265' })).toBeTruthy()
    expect(opsApi.getTrace).not.toHaveBeenCalled()
  })

  it('says so when there is no summary yet, rather than "0 steps"', () => {
    show(doc({ trace_summary: null }))
    expect(screen.getByRole('button', { name: 'AI trace · no steps recorded' })).toBeTruthy()
  })
})

describe('opening the accordion', () => {
  it('fetches the detail once, on the first open, and renders the redesigned panel content', async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: /ai trace/i }))
    await waitFor(() => expect(opsApi.getTrace).toHaveBeenCalledWith(7))
    expect(await screen.findByTestId('trace-panel')).toBeTruthy()
    expect(opsApi.getTrace).toHaveBeenCalledTimes(1)
  })

  it('does not re-fetch on a second open — the same report is reused', async () => {
    show()
    const trigger = screen.getByRole('button', { name: /ai trace/i })
    fireEvent.click(trigger) // open
    await screen.findByTestId('trace-panel')
    fireEvent.click(trigger) // close
    fireEvent.click(trigger) // open again
    await screen.findByTestId('trace-panel')
    expect(opsApi.getTrace).toHaveBeenCalledTimes(1)
  })

  it('collapses back on a second tap', async () => {
    show()
    const trigger = screen.getByRole('button', { name: /ai trace/i })
    fireEvent.click(trigger)
    await screen.findByTestId('trace-panel')
    fireEvent.click(trigger)
    expect(screen.queryByTestId('trace-panel')).toBeNull()
  })
})

describe('the panel content, credibility-first (item 3)', () => {
  const open = async () => {
    show()
    fireEvent.click(screen.getByRole('button', { name: /ai trace/i }))
    return within(await screen.findByTestId('trace-panel'))
  }

  it('shows the extracted result first, in plain field:value terms, with no raw confidence number by default', async () => {
    const panel = await open()
    expect(panel.getByText('Vendor:')).toBeTruthy()
    expect(panel.getByText('Acme Engineering')).toBeTruthy()
    expect(panel.getByText('436')).toBeTruthy()
    expect(panel.getByText(/corrected by a person/)).toBeTruthy() // the human-sourced field, flagged
    expect(panel.queryByText(/95%|90%/)).toBeNull() // no raw confidence in the primary view
  })

  it('shows the total cost once, at the top, not repeated per row', async () => {
    const panel = await open()
    expect(panel.getByText('AI trace · $0.0265 total')).toBeTruthy()
  })

  it('gives every step a plain-language label and a real status, not a raw node id as the primary thing shown', async () => {
    const panel = await open()
    // Scoped to the desktop table: jsdom renders both the table and the mobile stacked-card list at once (only a
    // CSS media query picks between them in a real browser), so an unscoped query would double-count everything.
    const table = within(panel.getByRole('table'))
    expect(table.getByText('Checked the document type')).toBeTruthy() // classify
    expect(table.getByText('Applied the filing rules')).toBeTruthy() // rules.transition_document, generic
    expect(table.getAllByText('Done')).toHaveLength(2) // both rows completed; neither failed nor skipped here
    expect(table.queryByText('classify')).toBeNull()
    expect(table.queryByText('rules.transition_document')).toBeNull()
  })

  it('says "No AI call — rule-based step" for a step with no model, never a row of dashes', async () => {
    const panel = await open()
    const table = within(panel.getByRole('table'))
    expect(table.getByText('No AI call: a rule-based step')).toBeTruthy()
    expect(table.queryByText('- / -')).toBeNull()
  })

  it('reveals the raw node id, model, tokens and decision only behind "View raw trace"', async () => {
    const panel = await open()
    const table = within(panel.getByRole('table'))
    expect(table.queryByText('sonnet4.5')).toBeNull()
    fireEvent.click(panel.getByRole('button', { name: 'View raw trace' }))
    expect(table.getByText('sonnet4.5')).toBeTruthy()
    expect(table.getByText('classify')).toBeTruthy()
    expect(panel.getByText(/95%/)).toBeTruthy() // confidence, now visible too
    fireEvent.click(panel.getByRole('button', { name: 'Hide raw trace' }))
    expect(table.queryByText('sonnet4.5')).toBeNull()
  })

  it('says so when the pipeline recorded no step at all, instead of a table with only a header', async () => {
    vi.mocked(opsApi.getTrace).mockResolvedValue({ nodes: [], total_cost_usd: 0, extraction: [] })
    const panel = await open()
    expect(panel.getByText('No AI steps were recorded for this document.')).toBeTruthy()
  })
})

describe('reads in other languages', () => {
  it.each([
    ['zh', '已检查文件类型'],
    ['ms', 'Menyemak jenis dokumen'],
    ['ta', 'ஆவண வகையைச் சரிபார்த்தது'],
  ])('the classify step label in %s', async (language, label) => {
    await i18n.changeLanguage(language)
    show()
    fireEvent.click(screen.getByRole('button', { name: /ai trace|追踪|jejak|தடமறிதல்/i }))
    // getAllByText, not getByText: jsdom renders both the desktop table and the mobile stacked-card list at once.
    expect((await screen.findAllByText(label)).length).toBeGreaterThan(0)
  })
})
