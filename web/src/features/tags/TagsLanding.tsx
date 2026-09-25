/** The real, signed-in Tags page: a fast visual entry point into Company
 * Files by category — not a new data view (2026-09-23, header/nav
 * restructure, explicit mapping). One button per bucket over the same fixed bucket
 * taxonomy the rest of the app already uses (BUCKETS, opsApi.ts),
 * each linking to Company Files pre-filtered to that bucket via a
 * `?bucket=` query param. Round 21 (A7, DECISIONS #101): a from/to date range chosen here rides along on those
 * links (`&from=&to=&basis=`), so "this tag, in this period" is two taps; the filtered list itself is Company Files'.
 * Only ever mounted once a session is confirmed —
 * `pages/Page.tsx`'s `tags` case shows the logged-out marketing
 * TagsPreview instead until then. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '../../router/Link'
import { routeHref } from '../../router/routes'
import { DateRangeFilter } from '../ops/DateRangeFilter'
import { NO_RANGE, rangeToParams, type DateBasis, type DateRange } from '../ops/documentDates'
import { BUCKETS } from '../ops/opsApi'
import { bucketLabel } from '../ops/opsShared'

export function TagsLanding() {
  const { t } = useTranslation()
  const [basis, setBasis] = useState<DateBasis>('upload')
  const [range, setRange] = useState<DateRange>(NO_RANGE)

  return (
    <div>
      <p className="mb-6 text-[14px] text-muted">{t('ops.tags.intro')}</p>
      <DateRangeFilter basis={basis} range={range} onBasisChange={setBasis} onRangeChange={setRange} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {BUCKETS.map((bucket) => (
          <Link
            key={bucket}
            href={`${routeHref('company-files')}?${new URLSearchParams({ bucket, ...rangeToParams(basis, range) })}`}
            className="rounded-card border border-line bg-white p-5 text-sm font-medium text-ink transition-colors hover:border-ink/40"
          >
            {bucketLabel(t, bucket)}
          </Link>
        ))}
      </div>
    </div>
  )
}
