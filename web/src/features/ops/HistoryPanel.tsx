/** A document's History: what PEOPLE did to it, in plain language, oldest first (round 6, DECISIONS #129). It replaced the AI-trace
 * content of the Company Files card's expandable panel: the panel itself, its place, border, spacing, chevron and lazy fetch are the
 * card's and are unchanged (DocumentCard.tsx); only what is inside it, and its words, changed.
 *
 * Each row is a sentence, "Uploaded by Frida", and the time it happened, in the viewer's language and the COMPANY's timezone. The
 * internal action codes (`uploaded`, `purge_requested`, ...) live in the API and the database and are never rendered: every one is
 * mapped to localized copy below. Nothing about models, steps, tokens or costs appears here: that is engineering observability, which
 * stays in the backend's `trace` table and is not part of what a person checks about their own document.
 *
 * Loading, error and empty states are the card's (it owns the fetch); this component only draws a loaded list, or the empty sentence. */

import { useTranslation } from 'react-i18next'
import { useOptionalAuth } from '../auth/AuthContext'
import { DEFAULT_COMPANY_TIMEZONE, formatDateTime, localeFor } from '../../lib/dates'
import type { DocumentActivityAction, DocumentActivityEntry } from './opsApi'

// One key per action: the sentence carries the person's name, so each language can put the name where its own grammar wants it.
const ACTION_KEY: Record<DocumentActivityAction, string> = {
  uploaded: 'ops.documents.history.uploaded',
  edited: 'ops.documents.history.edited',
  purge_requested: 'ops.documents.history.purgeRequested',
  purge_cancelled: 'ops.documents.history.purgeCancelled',
  deleted: 'ops.documents.history.deleted',
}

export function HistoryPanel({ entries }: { entries: DocumentActivityEntry[] }) {
  const { t, i18n } = useTranslation()
  const timezone = useOptionalAuth()?.company?.timezone ?? DEFAULT_COMPANY_TIMEZONE

  if (entries.length === 0) {
    return <p className="text-[14px] text-muted" data-testid="history-panel">{t('ops.documents.history.empty')}</p>
  }
  return (
    <ul className="space-y-2" data-testid="history-panel">
      {entries.map((entry, i) => {
        // An action with no person to name (a non-web upload with no identity) says so, rather than printing "null".
        const name = entry.actor_name?.trim() || t('ops.documents.history.unknownActor')
        return (
          <li key={i} className="flex flex-col gap-0.5 text-[13px] sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
            <span className="text-ink">{t(ACTION_KEY[entry.action] ?? 'ops.documents.history.unknownAction', { name })}</span>
            <span className="text-muted">{formatDateTime(entry.at, localeFor(i18n.language), timezone)}</span>
          </li>
        )
      })}
    </ul>
  )
}
