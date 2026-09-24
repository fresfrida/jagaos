/** One statutory obligation on the Calendar page (2026-09-24, round 16, item 10a).
 * It used to be a row of four table cells inside a card that clipped what did not
 * fit, so a long legal citation was cut off on a phone with no way to read the rest.
 * Now one stack that fits any width: title and status chip, then the due date and
 * priority, then the citation as smaller secondary text limited to two lines, which
 * opens to the whole text when tapped (only offered when it really is cut). */

import { ChevronDown } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../../components/ui/Badge'
import { cn } from '../../lib/cn'
import { formatShortDate, localeFor } from '../../lib/dates'
import type { Obligation } from '../ops/opsApi'
import { StatusPill, riskLabel } from '../ops/opsShared'

/** Whether a two-line-clamped element is actually cut (its text is taller than its box). */
function useIsClamped(text: string, clamped: boolean) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [isCut, setIsCut] = useState(false)
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current
      if (el && clamped) setIsCut(el.scrollHeight > el.clientHeight + 1)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [text, clamped])
  return { ref, isCut }
}

export function ObligationRow({ obligation }: { obligation: Obligation }) {
  const { t, i18n } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const { ref, isCut } = useIsClamped(obligation.citation, !expanded)
  // Once expanded the text is no longer cut, so "is it cut" alone would hide the
  // control that closes it again: keep offering it while expanded.
  const expandable = isCut || expanded

  return (
    <li className="px-4 py-3" data-testid="obligation-row">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-words text-[13px] font-medium text-ink">{obligation.label}</p>
        <StatusPill status={obligation.status} />
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
        <span>{t('ops.obligations.due', { date: formatShortDate(obligation.due_on, localeFor(i18n.language)) })}</span>
        <Badge tone="neutral">{riskLabel(t, obligation.risk)}</Badge>
      </p>
      {obligation.citation && (
        <div className="mt-1.5">
          <p ref={ref} className={cn('break-words text-[12px] leading-5 text-muted', !expanded && 'line-clamp-2')}>
            {obligation.citation}
          </p>
          {expandable && (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              aria-expanded={expanded}
              className="mt-0.5 inline-flex items-center gap-0.5 text-[12px] text-ink underline underline-offset-2 hover:text-muted"
            >
              {expanded ? t('ops.obligations.showLess') : t('ops.obligations.showMore')}
              <ChevronDown size={12} aria-hidden="true" className={cn('transition-transform', expanded && 'rotate-180')} />
            </button>
          )}
        </div>
      )}
    </li>
  )
}
