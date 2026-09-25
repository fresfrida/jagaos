/** The real, signed-in Calendar page: the documents-by-date section and nothing else (DECISIONS #108). It used to carry the
 * statutory obligations list and a one-line compliance-checklist count under it; both came off the Calendar, the first because
 * nothing is computed from a company's financial year end for now (the backend no longer derives obligations), the second
 * because the checklist itself lives in Company Settings. `ObligationRow` and `ChecklistSummary` are kept, unused, for when the
 * obligations come back through an ACRA API integration. Needs a session: `pages/Page.tsx`'s `calendar` case wraps it in
 * `RequireSession`, which sends a signed-out visitor to the landing page (DECISIONS #106; there is no signed-out Calendar). */

import { useTranslation } from 'react-i18next'
import { OpsStatusBar } from '../ops/OpsStatusBar'
import { useOpsData } from '../ops/useOpsData'
import { DatesView } from './DatesView'

export function CalendarHub() {
  const { t } = useTranslation()
  const { documents, apiUp, error, loaded } = useOpsData()

  return (
    <div>
      <OpsStatusBar apiUp={apiUp} />

      {error && (
        <div className="mb-4 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      <section>
        <h2 className="mb-3 text-[12px] font-mono uppercase tracking-wide text-muted">{t('ops.tabs.dates')}</h2>
        <DatesView documents={documents} loaded={loaded} />
      </section>
    </div>
  )
}
