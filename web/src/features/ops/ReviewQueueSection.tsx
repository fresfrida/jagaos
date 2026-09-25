/** The review queue on the Upload page (DECISIONS #109): the cards waiting for someone to confirm what was read, or, when nothing
 * is waiting, a short empty state. It used to render nothing at all for an empty queue, heading included, so a visitor landing
 * on an empty queue saw nothing to suggest that a review step exists; now the step is legible either way.
 *
 * An empty list means "nothing" only once the first load has finished, and never on top of a load error (the page shows its own
 * error banner), so the empty state cannot flash before the data arrives or contradict a failure. */

import { useTranslation } from 'react-i18next'
import type { ReviewItem } from './opsApi'
import { ReviewQueueCard } from './ReviewQueueCard'

export function ReviewQueueSection({
  items,
  loaded,
  failed,
  canResolve,
  onResolved,
  onRejected,
  onPoll,
}: {
  items: ReviewItem[]
  loaded: boolean
  failed: boolean
  canResolve: boolean
  onResolved: () => void
  onRejected: (filename: string) => void
  onPoll: () => void
}) {
  const { t } = useTranslation()

  if (items.length > 0) {
    return (
      <section>
        <h2 className="mb-3 text-[12px] font-mono uppercase tracking-wide text-amber-800">
          {t('ops.review.needsReview', { count: items.length })}
        </h2>
        <div className="space-y-3">
          {items.map((item) => (
            <ReviewQueueCard
              key={item.id}
              item={item}
              // The server's per-item answer wins where it sends one (an uploader may resolve their own personal file); an
              // older backend sends none, and the role check is what it always was.
              canResolve={item.can_resolve ?? canResolve}
              onResolved={onResolved}
              onRejected={onRejected}
              onPoll={onPoll}
            />
          ))}
        </div>
      </section>
    )
  }

  if (!loaded || failed) return null
  return (
    <section data-testid="review-empty">
      <h2 className="mb-3 text-[12px] font-mono uppercase tracking-wide text-muted">{t('ops.review.needsReview', { count: 0 })}</h2>
      <div className="rounded-card border border-line bg-white p-4">
        <p className="text-sm font-medium text-ink">{t('ops.review.empty')}</p>
        <p className="mt-1 text-[14px] text-muted">{t('ops.review.emptyHint')}</p>
      </div>
    </section>
  )
}
