/** Round 5, items 3b/3c (DECISIONS #125): plain-language labels and a real done/skipped/failed status for the AI-trace
 * panel, so it reads as an audit trail rather than a database dump. Both are pure functions of a trace row, kept out
 * of TracePanel.tsx so they can be unit-tested against exactly the real decision-text shapes the backend writes,
 * without rendering anything. */

import type { TFunction } from 'i18next'
import type { TraceReport } from './opsApi'

export type TraceNode = TraceReport['nodes'][number]
export type TraceStepStatus = 'done' | 'skipped' | 'failed'

// Every node value that actually appears in a trace row, confirmed by reading every `INSERT INTO trace` call site
// directly (app/graph/*.py, app/rules/transitions.py) — more than this round's own ask named (it named 7; a
// `rules.*` family of FIVE distinct transition helpers each write their own node value, and `classify_grounding` is
// a second, separate row classify.py writes, neither named explicitly). Every `rules.*` node collapses to one
// generic label below: they are all the same kind of thing, a deterministic status change written straight to the
// database (never an LLM call), and the raw decision text already says exactly which transition happened — kept
// behind "View raw trace" for anyone who wants the specifics. An unmapped node (a future one this file has not
// caught up to yet) falls back to the raw node id rather than showing nothing.
const NODE_LABEL_KEY: Record<string, string> = {
  classify: 'ops.documents.traceStep.classify',
  classify_grounding: 'ops.documents.traceStep.classifyGrounding',
  extract: 'ops.documents.traceStep.extract',
  verify: 'ops.documents.traceStep.verify',
  archive: 'ops.documents.traceStep.archive',
  derive_events: 'ops.documents.traceStep.deriveEvents',
  caption: 'ops.documents.traceStep.caption',
}
const RULES_LABEL_KEY = 'ops.documents.traceStep.rules'

export function traceStepLabel(t: TFunction, node: string): string {
  if (node.startsWith('rules.')) return t(RULES_LABEL_KEY)
  const key = NODE_LABEL_KEY[node]
  return key ? t(key) : node
}

/** done / skipped / failed, derived from what is ACTUALLY in each node's own decision text — never invented.
 * `extract`'s own retry marker (`..._schema_mismatch`, its one real failure path, app/graph/extract.py) is the
 * only "failed" a trace can hold today; `derive_events`'s own explicit `skipped_<reason>` (app/graph/
 * derive_events.py) is the only "skipped". Every other row reaching this far already completed its step: a
 * transition or an archive that raised an exception would never have reached its own INSERT, and verify's
 * "quarantined"/"needs_review" and derive_events's "proposed"/"no_event" are OUTCOMES of a completed check, not a
 * failure of the step itself — the raw decision text (behind "View raw trace") says which outcome. */
export function traceStepStatus(node: TraceNode): TraceStepStatus {
  const decision = node.decision ?? ''
  if (node.node === 'extract' && decision.endsWith('_schema_mismatch')) return 'failed'
  if (node.node === 'derive_events' && decision.startsWith('skipped_')) return 'skipped'
  return 'done'
}

/** A step with no AI call at all (model is NULL: every `rules.*` transition, `archive`, `verify`, the skipped half
 * of `derive_events`) must say so plainly rather than showing a row of dashes, which reads as missing data, not as
 * "nothing to show here by design" (DECISIONS #125). A step that DID call a real model but has no cost (`caption`,
 * a genuine local-model call that is simply free) is NOT this — it shows its model name and "-" for cost, same as
 * before, since a model name being present is what tells the two apart. */
export function traceHasAiCall(node: TraceNode): boolean {
  return node.model !== null
}
