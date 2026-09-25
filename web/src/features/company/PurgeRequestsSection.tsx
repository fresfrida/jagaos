/** The owner's pending purge requests, a section of Company Settings (round 21, A5, DECISIONS #101). A purged-for-now
 * document is archived and so appears in no other list; this is where "purge requested: the team removes it permanently"
 * is visible. Owner only (the endpoint refuses anyone else); nothing is deleted from here. */

import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { formatShortDate, localeFor } from '../../lib/dates'
import { middleEllipsis } from '../../lib/filename'
import { usePurgeRequests } from './usePurgeRequests'

export function PurgeRequestsSection({ enabled }: { enabled: boolean }) {
  const { t, i18n } = useTranslation()
  const { state, retry } = usePurgeRequests(enabled)

  const count = state.status === 'ready' ? state.requests.length : 0
  return (
    <section className="mt-10 max-w-2xl" aria-labelledby="company-purge-requests-heading">
      <h2 id="company-purge-requests-heading" className="mb-3 text-[12px] font-mono uppercase tracking-wide text-muted">
        {t('companySettings.purgeRequests.heading', { count })}
      </h2>
      {state.status === 'loading' && <p className="text-[14px] text-muted" role="status">{t('companySettings.purgeRequests.loading')}</p>}
      {state.status === 'failed' && (
        <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          <p>{t('companySettings.purgeRequests.loadFailed')}</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={retry}>{t('common.buttons.retry')}</Button>
        </div>
      )}
      {state.status === 'ready' && (
        <Card className="overflow-hidden p-0" interactive={false}>
          {state.requests.length === 0 ? (
            <p className="p-6 text-sm text-muted">{t('companySettings.purgeRequests.empty')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {state.requests.map((request) => (
                <li key={request.id} className="px-4 py-3" data-testid="purge-request-row">
                  <p className="break-words text-[14px] font-medium text-ink">{middleEllipsis(request.filename, 60)}</p>
                  <p className="mt-0.5 text-[13px] text-ink">{t('companySettings.purgeRequests.status')}</p>
                  <p className="mt-0.5 text-[13px] text-muted">
                    {t('companySettings.purgeRequests.by', {
                      date: formatShortDate(request.requested_at, localeFor(i18n.language)),
                      who: request.requested_by ?? '-',
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </section>
  )
}
