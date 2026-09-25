/** The owner's pending purge requests, a section of Company Settings (round 21, A5, DECISIONS #101). A purged-for-now
 * document is archived and so appears in no other list; this is where "purge requested: the team removes it permanently"
 * is visible. Owner only (the endpoint refuses anyone else); nothing is deleted from here. */

import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { formatShortDate, localeFor } from '../../lib/dates'
import { FileName } from '../../components/ui/FileName'
import { middleEllipsis } from '../../lib/filename'
import { formatDocumentLabel } from '../ops/opsShared'
import { usePurgeRequests } from './usePurgeRequests'

export function PurgeRequestsSection({ enabled }: { enabled: boolean }) {
  const { t, i18n } = useTranslation()
  const { state, retry } = usePurgeRequests(enabled)

  const count = state.status === 'ready' ? state.requests.length : 0
  return (
    <section className="mt-10" aria-labelledby="company-purge-requests-heading">
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
                  {/* The document's own label first (vendor and type, or its description), the file name only as small text under it
                     (DECISIONS #109), exactly as the Calendar's day list does; with no label to show, the file name is the title. */}
                  <p className="break-words text-[14px] font-medium text-ink">
                    {formatDocumentLabel(
                      { vendor_name: request.vendor_name ?? null, doc_type: request.doc_type ?? null, description: request.description ?? null },
                      i18n.language,
                    ) || middleEllipsis(request.filename, 60)}
                  </p>
                  {(request.vendor_name || request.doc_type || request.description) && (
                    <FileName name={request.filename} max={40} className="block truncate text-[12px] text-muted" />
                  )}
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
