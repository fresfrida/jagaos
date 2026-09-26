import { describe, expect, it } from 'vitest'
import { traceHasAiCall, traceStepLabel, traceStepStatus, type TraceNode } from './traceDisplay'

const t = ((key: string) => key) as never // identity: these tests assert on the KEY, not a translated string

function node(overrides: Partial<TraceNode>): TraceNode {
  return { node: 'classify', model: null, input_tokens: null, output_tokens: null, cost_usd: null, latency_ms: null, decision: null, at: '2026-01-01', ...overrides }
}

describe('traceStepLabel', () => {
  it('maps every real node value this app writes, confirmed against every INSERT INTO trace call site', () => {
    expect(traceStepLabel(t, 'classify')).toBe('ops.documents.traceStep.classify')
    expect(traceStepLabel(t, 'classify_grounding')).toBe('ops.documents.traceStep.classifyGrounding')
    expect(traceStepLabel(t, 'extract')).toBe('ops.documents.traceStep.extract')
    expect(traceStepLabel(t, 'verify')).toBe('ops.documents.traceStep.verify')
    expect(traceStepLabel(t, 'archive')).toBe('ops.documents.traceStep.archive')
    expect(traceStepLabel(t, 'derive_events')).toBe('ops.documents.traceStep.deriveEvents')
    expect(traceStepLabel(t, 'caption')).toBe('ops.documents.traceStep.caption')
  })

  it('collapses every rules.* transition helper to one generic label, not five', () => {
    for (const n of [
      'rules.transition_document', 'rules.transition_obligation', 'rules.file_personal_document',
      'rules.restore_after_purge_request', 'rules.reopen_expectation', 'rules.transition_expectation',
    ]) {
      expect(traceStepLabel(t, n)).toBe('ops.documents.traceStep.rules')
    }
  })

  it('falls back to the raw node id for anything unmapped, never blank', () => {
    expect(traceStepLabel(t, 'a_future_node_this_file_does_not_know_yet')).toBe('a_future_node_this_file_does_not_know_yet')
  })
})

describe('traceStepStatus', () => {
  it('extract: the schema-mismatch retry marker is the one real failure path', () => {
    expect(traceStepStatus(node({ node: 'extract', decision: 'invoice_schema_mismatch' }))).toBe('failed')
    expect(traceStepStatus(node({ node: 'extract', decision: 'invoice' }))).toBe('done')
  })

  it('derive_events: an explicit skip is skipped, a real outcome either way is done', () => {
    expect(traceStepStatus(node({ node: 'derive_events', decision: 'skipped_no_statutory_lane' }))).toBe('skipped')
    expect(traceStepStatus(node({ node: 'derive_events', decision: 'proposed' }))).toBe('done')
    expect(traceStepStatus(node({ node: 'derive_events', decision: 'no_event' }))).toBe('done')
  })

  it('verify: an outcome of a completed check is done, not failed, whichever way it went', () => {
    expect(traceStepStatus(node({ node: 'verify', decision: 'quarantined' }))).toBe('done')
    expect(traceStepStatus(node({ node: 'verify', decision: 'needs_review' }))).toBe('done')
  })

  it('a rules.* transition and archive are always done: an exception before their own INSERT would leave no row at all', () => {
    expect(traceStepStatus(node({ node: 'rules.transition_document', decision: 'filed->archived by x' }))).toBe('done')
    expect(traceStepStatus(node({ node: 'archive', decision: 'events=1 expectations=0 obligations=1' }))).toBe('done')
  })

  it('classify and caption are always done: no failure path writes a row for either', () => {
    expect(traceStepStatus(node({ node: 'classify', decision: 'invoice/invoice' }))).toBe('done')
    expect(traceStepStatus(node({ node: 'caption', model: 'blip-image-captioning-base', decision: 'a photo of a desk' }))).toBe('done')
  })
})

describe('traceHasAiCall', () => {
  it('is false for every decision-only row (no AI call at all)', () => {
    expect(traceHasAiCall(node({ node: 'archive', model: null }))).toBe(false)
    expect(traceHasAiCall(node({ node: 'rules.transition_document', model: null }))).toBe(false)
    expect(traceHasAiCall(node({ node: 'verify', model: null }))).toBe(false)
  })

  it('is true for a real model call even with no token cost (a local model, genuinely free)', () => {
    expect(traceHasAiCall(node({ node: 'caption', model: 'blip-image-captioning-base', cost_usd: null }))).toBe(true)
  })

  it('is true for a real gateway call', () => {
    expect(traceHasAiCall(node({ node: 'classify', model: 'sonnet4.5', cost_usd: 0.002 }))).toBe(true)
  })
})
