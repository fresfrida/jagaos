/** The real, signed-in Calendar page: documents by date, statutory
 * obligations by due date, and the gap-analysis view, as sections on one
 * page (2026-09-23, header/nav restructure — explicit decision: these
 * three former OpsConsole tabs are "find something by when it matters"
 * concerns, none of them named individually in the header's five-item
 * nav, so they're grouped here under Calendar rather than each getting
 * its own top-level route). Needs a session: `pages/Page.tsx`'s
 * `calendar` case wraps it in `RequireSession`, which sends a signed-out
 * visitor to the landing page (DECISIONS #106; there is no signed-out
 * Calendar any more). */

import { useTranslation } from 'react-i18next'
import { Card } from '../../components/ui/Card'
import { useAuth } from '../auth/AuthContext'
import { roleAtLeast } from '../auth/authApi'
import { OpsStatusBar } from '../ops/OpsStatusBar'
import { useOpsData } from '../ops/useOpsData'
import { ChecklistSummary } from './ChecklistSummary'
import { DatesView } from './DatesView'
import { ObligationRow } from './ObligationRow'

export function CalendarHub() {
  const { t } = useTranslation()
  const { role } = useAuth()
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
          <h2 className="mb-3 text-[12px] font-mono uppercase tracking-wide text-muted">{t('ops.tabs.dates')}</h2>
          <DatesView documents={documents} />
        </section>

        <section>
          <h2 className="mb-3 text-[12px] font-mono uppercase tracking-wide text-muted">
            {t('ops.obligations.heading', { count: obligations.length })}
          </h2>
          <Card className="overflow-hidden p-0" interactive={false}>
            {obligations.length === 0 ? (
              <p className="p-6 text-sm text-muted">{t('ops.obligations.empty')}</p>
            ) : (
              <ul className="divide-y divide-line">
                {obligations.map((ob) => <ObligationRow key={ob.id} obligation={ob} />)}
              </ul>
            )}
          </Card>
        </section>

        {/* Round 21 (A2, DECISIONS #101): the full checklist moved to Company Settings; the Calendar keeps the count. */}
        <ChecklistSummary expectations={expectations} canOpen={role !== null && roleAtLeast(role, 'admin')} />
      </div>
    </div>
  )
}
