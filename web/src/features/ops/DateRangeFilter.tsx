/** From / to date inputs plus the Uploaded / Document dates switch (round 21, A7, DECISIONS #101). Presentational: it
 * shows the range it is given and reports changes; what the range does to a list is documentDates.ts. Native
 * `<input type="date">`, so a phone gets its own date wheel and a desktop its own picker, with no picker library. */

import { useTranslation } from 'react-i18next'
import { DateBasisToggle } from './DateBasisToggle'
import { rangeIsBackwards, rangeIsSet, type DateBasis, type DateRange } from './documentDates'

const INPUT_CLASS =
  'mt-1 block h-9 w-full rounded-control border border-line bg-white px-2.5 text-[14px] text-ink outline-none focus:border-ink'

export function DateRangeFilter({
  basis, range, onBasisChange, onRangeChange,
}: {
  basis: DateBasis
  range: DateRange
  onBasisChange: (basis: DateBasis) => void
  onRangeChange: (range: DateRange) => void
}) {
  const { t } = useTranslation()
  const backwards = rangeIsBackwards(range)
  return (
    <fieldset className="mb-4 rounded-card border border-line bg-white p-3" data-testid="date-range-filter">
      <legend className="px-1 text-[12px] font-mono uppercase tracking-wide text-muted">{t('ops.documents.filter.dateRange')}</legend>
      <DateBasisToggle basis={basis} onChange={onBasisChange} className="mb-3" />
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <label className="text-[14px] text-muted">
          {t('ops.documents.filter.dateFrom')}
          <input
            type="date"
            value={range.from}
            max={range.to || undefined}
            onChange={(event) => onRangeChange({ ...range, from: event.target.value })}
            className={INPUT_CLASS}
          />
        </label>
        <label className="text-[14px] text-muted">
          {t('ops.documents.filter.dateTo')}
          <input
            type="date"
            value={range.to}
            min={range.from || undefined}
            onChange={(event) => onRangeChange({ ...range, to: event.target.value })}
            className={INPUT_CLASS}
          />
        </label>
      </div>
      {backwards && <p role="alert" className="mt-2 text-[13px] text-red-700">{t('ops.documents.filter.dateBackwards')}</p>}
      {rangeIsSet(range) && (
        <button
          type="button"
          onClick={() => onRangeChange({ from: '', to: '' })}
          className="mt-2 text-[13px] text-ink underline underline-offset-2 hover:text-muted"
        >
          {t('ops.documents.filter.dateClear')}
        </button>
      )}
    </fieldset>
  )
}
