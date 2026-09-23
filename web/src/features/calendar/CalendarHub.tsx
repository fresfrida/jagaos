/** The real, signed-in Calendar page: documents by date, statutory
 * obligations by due date, and the gap-analysis view, as sections on one
 * page (2026-09-23, header/nav restructure — explicit decision: these
 * three former OpsConsole tabs are "find something by when it matters"
 * concerns, none of them named individually in the header's five-item
 * nav, so they're grouped here under Calendar rather than each getting
 * its own top-level route). Only ever mounted once a session is
 * confirmed — `pages/Page.tsx`'s `calendar` case shows the logged-out
 * marketing CalendarPreview instead until then, so this doesn't need its
 * own RequireSession guard. */

import { useTranslation } from 'react-i18next'
import { Badge } from '../../components/ui/Badge'
import { Card } from '../../components/ui/Card'
import { OpsStatusBar } from '../ops/OpsStatusBar'
import { StatusPill } from '../ops/opsShared'
import { useOpsData } from '../ops/useOpsData'
import { DatesView } from './DatesView'

export function CalendarHub() {
  const { t } = useTranslation()
  const { documents, expectations, obligations, apiUp, error } = useOpsData()

  return (
    <div>
      <OpsStatusBar apiUp={apiUp} />

      {error && (
        <div className="mb-4 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      <div className="space-y-10">
        <section>
          <h2 className="mb-3 text-[11px] font-mono uppercase tracking-wide text-muted">{t('ops.tabs.dates')}</h2>
          <DatesView documents={documents} />
        </section>

        <section>
          <h2 className="mb-3 text-[11px] font-mono uppercase tracking-wide text-muted">
            {t('ops.obligations.heading', { count: obligations.length })}
          </h2>
          <Card className="overflow-hidden p-0" interactive={false}>
            {obligations.length === 0 ? (
              <p className="p-6 text-sm text-muted">{t('ops.obligations.empty')}</p>
            ) : (
              <table className="w-full text-left text-[13px]">
                <tbody>
                  {obligations.map((ob) => (
                    <tr key={ob.id} className="border-b border-line last:border-0 align-top">
                      <td className="px-4 py-2.5 text-ink">
                        {ob.label}
                        <Badge tone="neutral" className="ml-2">{ob.risk}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted">{ob.due_on}</td>
                      <td className="px-4 py-2.5"><StatusPill status={ob.status} /></td>
                      <td className="max-w-xs px-4 py-2.5 text-[12px] text-muted">{ob.citation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-[11px] font-mono uppercase tracking-wide text-muted">
            {t('ops.gaps.heading', { satisfied: expectations.filter((e) => e.status === 'satisfied').length, total: expectations.length })}
          </h2>
          <Card className="overflow-hidden p-0" interactive={false}>
            {expectations.length === 0 ? (
              <p className="p-6 text-sm text-muted">{t('ops.gaps.empty')}</p>
            ) : (
              <table className="w-full text-left text-[13px]">
                <tbody>
                  {expectations.map((exp) => (
                    <tr key={exp.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5 text-ink">{exp.label}</td>
                      <td className="px-4 py-2.5"><StatusPill status={exp.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </section>
      </div>
    </div>
  )
}
