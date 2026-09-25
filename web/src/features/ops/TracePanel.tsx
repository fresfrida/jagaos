/** The AI trace of one document: which pipeline step ran, on which model, at what token cost, and what it decided (DECISIONS #110 named it
 * "AI trace"). Extracted from DocumentResultsList in round 3, item 5 (DECISIONS #121), which also fixed where it appears.
 *
 * WHERE: directly under the card it was asked from. It used to be rendered once, after the WHOLE list, so on a list of 19 documents a tap on
 * the first card's "AI trace" drew the panel about 5,700px further down (measured at 375px) with the page not moving: it looked as if
 * nothing had happened. It also scrolls itself into view when it opens, for a card near the bottom of the screen.
 *
 * EMPTY: a document whose pipeline recorded no step at all gets a sentence saying so instead of a table with only a header. */

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '../../components/ui/Card'
import type { TraceReport } from './opsApi'

export function TracePanel({ documentId, report }: { documentId: number; report: TraceReport }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLElement | null>(null)

  // Optional call: jsdom has no scrollIntoView. `nearest` moves the page only as far as needed to bring the panel into view; the panel's
  // `scroll-mb-24` keeps its foot clear of the phone's fixed bottom bar, which `nearest` cannot know about (measured: without it the
  // panel came to rest flush with the screen edge and the bar covered its last 64px).
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [documentId])

  return (
    <section ref={ref} aria-label={t('ops.documents.trace')} className="mt-2 scroll-mb-24" data-testid="trace-panel">
      <h2 className="mb-3 text-[12px] font-mono uppercase tracking-wide text-muted">
        {t('ops.documents.traceHeading', { documentId, cost: report.total_cost_usd.toFixed(4) })}
      </h2>
      <Card className="overflow-hidden p-0" interactive={false}>
        {report.nodes.length === 0 ? (
          <p className="p-4 text-[14px] text-muted">{t('ops.documents.traceEmpty')}</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="bg-canvas text-muted">
              <tr>
                <th className="px-4 py-2 font-normal">{t('ops.documents.traceTable.node')}</th>
                <th className="px-4 py-2 font-normal">{t('ops.documents.traceTable.model')}</th>
                <th className="px-4 py-2 font-normal">{t('ops.documents.traceTable.tokens')}</th>
                <th className="px-4 py-2 font-normal">{t('ops.documents.traceTable.cost')}</th>
                <th className="px-4 py-2 font-normal">{t('ops.documents.traceTable.decision')}</th>
              </tr>
            </thead>
            <tbody>
              {report.nodes.map((node, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-4 py-2 text-ink">{node.node}</td>
                  <td className="px-4 py-2 text-muted">{node.model ?? '-'}</td>
                  <td className="px-4 py-2 text-muted">
                    {node.input_tokens ?? '-'} / {node.output_tokens ?? '-'}
                  </td>
                  <td className="px-4 py-2 text-muted">{node.cost_usd ? `$${node.cost_usd.toFixed(5)}` : '-'}</td>
                  <td className="px-4 py-2 text-muted">{node.decision ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  )
}
