/** The flagged-reason block on a review card (2026-09-24, round 11): one
 * sentence for a single reason, a short list for several distinct ones —
 * layout decided by opsShared.tsx's reasonDisplay(), so the two places the
 * card shows it (headline, and again above the action buttons) cannot
 * disagree. `className` carries the text size/colour, which differ between
 * those two places. */

import { useTranslation } from 'react-i18next'
import { reasonDisplay } from './opsShared'
import type { ReviewReason } from './opsApi'

export function ReviewReasons({ reasons, className }: { reasons: ReviewReason[]; className: string }) {
  const { t } = useTranslation()
  const display = reasonDisplay(t, reasons)

  if (display.layout === 'text') return <p className={className}>{display.text}</p>

  return (
    <div className={className}>
      <p>{display.heading}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 font-normal">
        {display.items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
