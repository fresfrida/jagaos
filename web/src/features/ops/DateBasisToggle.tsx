/** The two-way "Uploaded / Document dates" switch, shared by the Calendar's Dates view and the date-range filter
 * (round 21, A1 and A7, DECISIONS #101): one segmented control, one set of labels. */

import { useTranslation } from 'react-i18next'
import type { DateBasis } from './documentDates'

const OPTIONS: { id: DateBasis; labelKey: string }[] = [
  { id: 'upload', labelKey: 'ops.dates.basis.uploaded' },
  { id: 'document', labelKey: 'ops.dates.basis.document' },
]

export function DateBasisToggle({
  basis, onChange, className = '',
}: {
  basis: DateBasis
  onChange: (basis: DateBasis) => void
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <div className={`flex w-fit gap-0.5 rounded-control border border-line p-0.5 ${className}`}>
      {OPTIONS.map((option) => {
        const active = basis === option.id
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className={`rounded-md px-3 py-1.5 text-[14px] transition-colors ${active ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
          >
            {t(option.labelKey)}
          </button>
        )
      })}
    </div>
  )
}
