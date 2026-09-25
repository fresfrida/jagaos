/** The Calendar's one-line stand-in for the compliance checklist (round 21, A2, DECISIONS #101): how many of the
 * company's expected documents it holds, and, for a role that may open Company Settings (admin and owner), a link to the
 * full checklist there. Any other role sees the count without a link: /company-settings would only send them back to the
 * Calendar, so a link would be a dead end (KANBAN: they no longer see WHICH items are missing). Presentational. */

import { ChevronRight, ListChecks } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card } from '../../components/ui/Card'
import type { Expectation } from '../ops/opsApi'
import { Link } from '../../router/Link'
import { routeHref } from '../../router/routes'

export function ChecklistSummary({ expectations, canOpen }: { expectations: Expectation[]; canOpen: boolean }) {
  const { t } = useTranslation()
  const satisfied = expectations.filter((e) => e.status === 'satisfied').length
  const text = t('ops.gaps.heading', { satisfied, total: expectations.length })
  return (
    <section>
      <Card className="p-0" interactive={false}>
        {canOpen ? (
          <Link
            href={routeHref('company-settings')}
            data-testid="checklist-summary"
            className="flex items-center gap-3 px-4 py-3 text-[14px] text-ink transition-colors hover:bg-canvas"
          >
            <ListChecks size={18} className="shrink-0 text-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{text}</span>
              <span className="block text-[13px] text-muted">{t('ops.gaps.openInSettings')}</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden="true" />
          </Link>
        ) : (
          <p data-testid="checklist-summary" className="flex items-center gap-3 px-4 py-3 text-[14px] font-medium text-ink">
            <ListChecks size={18} className="shrink-0 text-muted" aria-hidden="true" />
            {text}
          </p>
        )}
      </Card>
    </section>
  )
}
