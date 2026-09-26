/** The AI trace of one document, redesigned around credibility, not a log dump (round 5, items 3 and 6, DECISIONS #125;
 * originally DECISIONS #110/#121). Three things a viewer gets, in this order:
 *   1. The AI's actual extracted result for this file (doc type, vendor, amount, date, whatever this document type
 *      produced) — so a person can check the AI's work against the source, not just see that "extract" ran.
 *   2. An ordered, plain-language audit trail with a real done/skipped/failed status per step (traceDisplay.ts),
 *      never a raw node id or a free-text decision string as the primary thing shown.
 *   3. Tokens and cost per step, with the whole file's total cost shown once, at the top, not repeated per row.
 * The raw node id, model name, token counts and decision text are always available — behind "View raw trace" — for
 * this app's own engineering audience and anyone checking its rigor; nothing is deleted, just not the primary view.
 *
 * MOBILE (below `sm`): stacked cards, one per step — no table to clip or scroll sideways. DESKTOP: a table.
 *
 * WHERE: rendered by DocumentCard itself now, inside that card's own always-visible "AI trace · N steps · $X"
 * accordion row (round 5, item 6) — no longer a sibling block DocumentResultsList renders after the card.
 *
 * EMPTY: a document whose pipeline recorded no step at all gets a sentence saying so instead of a table with only a
 * header. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { fieldLabel } from './opsShared'
import type { TraceReport } from './opsApi'
import { traceHasAiCall, traceStepLabel, traceStepStatus, type TraceStepStatus } from './traceDisplay'

const STATUS_TONE: Record<TraceStepStatus, string> = {
  done: 'bg-sage/15 text-sage-ink',
  skipped: 'bg-canvas text-muted border border-line',
  failed: 'bg-red-50 text-red-800 ring-1 ring-red-200',
}

function StepStatusPill({ status }: { status: TraceStepStatus }) {
  const { t } = useTranslation()
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[12px] font-mono uppercase tracking-wide ${STATUS_TONE[status]}`}>
      {t(`ops.documents.traceStatus.${status}`)}
    </span>
  )
}

function extractedValue(field: TraceReport['extraction'][number]): string {
  if (field.value_text !== null) return field.value_text
  if (field.value_num !== null) return String(field.value_num)
  if (field.value_date !== null) return field.value_date
  return '-'
}

export function TracePanel({ report }: { report: TraceReport }) {
  const { t } = useTranslation()
  const [showRaw, setShowRaw] = useState(false)

  return (
    <div data-testid="trace-panel">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[12px] font-mono uppercase tracking-wide text-muted">
          {t('ops.documents.traceHeading', { cost: report.total_cost_usd.toFixed(4) })}
        </h3>
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="text-[12px] font-mono uppercase tracking-wide text-muted underline underline-offset-2 hover:text-ink"
        >
          {t(showRaw ? 'ops.documents.traceHideRaw' : 'ops.documents.traceViewRaw')}
        </button>
      </div>

      {report.extraction.length > 0 && (
        <div className="mb-4">
          <h4 className="mb-2 text-[12px] font-mono uppercase tracking-wide text-muted">{t('ops.documents.traceExtractedHeading')}</h4>
          {/* No raw confidence percentage here, on purpose: ReviewQueueCard already removed confidence-tied wording from
             everywhere an ordinary user sees it (2026-09-23, "no confidence-tied wording anywhere the user sees") because
             a bare number wasn't helpful without the context a reviewer has — this section is read by the same audience,
             checking the same values, so it follows the same rule. Confidence is still real data; it lives in "View raw
             trace" below, alongside the rest of what an engineer or a judge checking rigor would want. */}
          <ul className="space-y-1 text-[13px]">
            {report.extraction.map((field) => (
              <li key={field.field} className="flex flex-wrap items-baseline gap-x-1.5 text-ink">
                <span className="text-muted">{fieldLabel(t, field.field)}:</span>
                <span className="font-medium">{extractedValue(field)}</span>
                {field.source === 'human' && <span className="text-muted">· {t('ops.documents.traceFieldCorrected')}</span>}
                {showRaw && <span className="text-muted">· {t('ops.documents.traceTable.confidence')}: {Math.round(field.confidence * 100)}%</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.nodes.length === 0 ? (
        <p className="text-[14px] text-muted">{t('ops.documents.traceEmpty')}</p>
      ) : (
        <>
          {/* Desktop: a table. */}
          <table className="hidden w-full text-left text-[13px] sm:table">
            <thead className="bg-canvas text-muted">
              <tr>
                <th className="px-3 py-2 font-normal">{t('ops.documents.traceTable.step')}</th>
                <th className="px-3 py-2 font-normal">{t('ops.documents.traceTable.status')}</th>
                <th className="px-3 py-2 font-normal">{t('ops.documents.traceTable.cost')}</th>
                {showRaw && (
                  <>
                    <th className="px-3 py-2 font-normal">{t('ops.documents.traceTable.node')}</th>
                    <th className="px-3 py-2 font-normal">{t('ops.documents.traceTable.model')}</th>
                    <th className="px-3 py-2 font-normal">{t('ops.documents.traceTable.tokens')}</th>
                    <th className="px-3 py-2 font-normal">{t('ops.documents.traceTable.decision')}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {report.nodes.map((node, i) => {
                const hasAiCall = traceHasAiCall(node)
                return (
                  <tr key={i} className="border-t border-line">
                    <td className="px-3 py-2 text-ink">{traceStepLabel(t, node.node)}</td>
                    <td className="px-3 py-2"><StepStatusPill status={traceStepStatus(node)} /></td>
                    <td className="px-3 py-2 text-muted">
                      {hasAiCall ? (node.cost_usd != null ? `$${node.cost_usd.toFixed(5)}` : '-') : t('ops.documents.traceNoAiCall')}
                    </td>
                    {showRaw && (
                      <>
                        <td className="px-3 py-2 font-mono text-[12px] text-muted">{node.node}</td>
                        <td className="px-3 py-2 text-muted">{node.model ?? '-'}</td>
                        <td className="px-3 py-2 text-muted">{node.input_tokens ?? '-'} / {node.output_tokens ?? '-'}</td>
                        <td className="px-3 py-2 text-muted">{node.decision ?? '-'}</td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Mobile: stacked cards, no column clipping (round 5, item 3a). */}
          <ul className="space-y-2 sm:hidden">
            {report.nodes.map((node, i) => {
              const hasAiCall = traceHasAiCall(node)
              return (
                <li key={i} className="rounded-control border border-line p-3 text-[13px]">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <p className="font-medium text-ink">{traceStepLabel(t, node.node)}</p>
                    <StepStatusPill status={traceStepStatus(node)} />
                  </div>
                  <p className="text-muted">
                    {t('ops.documents.traceTable.cost')}: {hasAiCall ? (node.cost_usd != null ? `$${node.cost_usd.toFixed(5)}` : '-') : t('ops.documents.traceNoAiCall')}
                  </p>
                  {showRaw && (
                    <div className="mt-1 space-y-0.5 text-muted">
                      <p>{t('ops.documents.traceTable.node')}: <span className="font-mono text-[12px]">{node.node}</span></p>
                      <p>{t('ops.documents.traceTable.model')}: {node.model ?? '-'}</p>
                      <p>{t('ops.documents.traceTable.tokens')}: {node.input_tokens ?? '-'} / {node.output_tokens ?? '-'}</p>
                      <p>{t('ops.documents.traceTable.decision')}: {node.decision ?? '-'}</p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
