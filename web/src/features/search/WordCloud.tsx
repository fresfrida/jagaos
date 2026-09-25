/** The word cloud on the Search page (round 21, A8, DECISIONS #101): the words that come up across the company's documents,
 * bigger where more documents contain them. Each word is a button that runs that search: cheap because Search already runs a
 * query from a string. Presentational; the fetch is useSearchTerms and the sizing is cloudSizing.ts. Shown only when there is
 * something to show: no words, or a backend without the endpoint, and it renders nothing. */

import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { sizeTerms } from './cloudSizing'
import type { SearchTermsState } from './useSearchTerms'

export function WordCloud({ state, onRetry, onPick }: { state: SearchTermsState; onRetry: () => void; onPick: (term: string) => void }) {
  const { t } = useTranslation()

  if (state.status === 'unavailable') return null
  if (state.status === 'loading') return <p className="mt-6 text-[14px] text-muted" role="status">{t('ops.search.cloud.loading')}</p>
  if (state.status === 'failed') {
    return (
      <div className="mt-6 text-[14px] text-muted">
        <p role="status">{t('ops.search.cloud.failed')}</p>
        <Button size="sm" variant="secondary" className="mt-2" onClick={onRetry}>{t('common.buttons.retry')}</Button>
      </div>
    )
  }
  if (state.terms.length === 0) return null

  return (
    <section className="mt-6" aria-labelledby="search-cloud-heading" data-testid="word-cloud">
      <h2 id="search-cloud-heading" className="mb-1 text-[12px] font-mono uppercase tracking-wide text-muted">{t('ops.search.cloud.heading')}</h2>
      <p className="mb-3 text-[13px] text-muted">{t('ops.search.cloud.hint')}</p>
      <ul className="flex flex-wrap items-baseline gap-x-4 gap-y-2 rounded-card border border-line bg-white p-4">
        {sizeTerms(state.terms).map((word) => (
          <li key={word.term}>
            <button
              type="button"
              onClick={() => onPick(word.term)}
              style={{ fontSize: `${word.px}px` }}
              className="rounded-control px-0.5 leading-tight text-ink transition-colors hover:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              {word.term}{' '}
              <span className="sr-only">({word.count})</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
