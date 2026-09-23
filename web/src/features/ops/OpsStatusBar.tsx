/** The small "backend reachable" + "company · email · role" line that used
 * to render once above OpsConsole's tab bar — now repeated at the top of
 * each of the 5 pages promoted from its tabs (2026-09-23), since each is
 * its own mount with no shared root to hang one copy off of. `apiUp`
 * omitted (not just `null`) skips the backend-health line entirely — the
 * Search page has no bulk data fetch to hang a health check on and isn't
 * worth adding one just for this. */

import { useTranslation } from 'react-i18next'
import { Badge } from '../../components/ui/Badge'
import { useAuth } from '../auth/AuthContext'
import { roleLabel } from './opsShared'

export function OpsStatusBar({ apiUp }: { apiUp?: boolean | null }) {
  const { t } = useTranslation()
  const { status, company, user, role } = useAuth()

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
      {apiUp !== undefined && (
        <span className="inline-flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${apiUp ? 'bg-sage' : 'bg-red-500'}`} aria-hidden="true" />
          {apiUp === null && t('ops.backend.checking')}
          {apiUp === true && t('ops.backend.reachable')}
          {apiUp === false && t('ops.backend.unreachable')}
        </span>
      )}
      {/* 2026-09-23 (live bug report): `company`/`user` resolve async from
         `/api/auth/me` (AuthContext.tsx), so this whole row was previously
         just absent — no reserved space — until that resolves. Confirmed
         as a real (if usually sub-second on a fast connection) paint-
         before-data-loads gap, not an i18n bug: this component has no
         language-conditional code, one screenshot in the report just
         caught a fresher reload than the other. A skeleton reserves the
         row's height instead of a layout jump once the real content pops
         in — chosen over "accept the blank state" because the gap scales
         with real network latency (this repo's backend is a separate
         cross-origin host, DECISIONS #32), not just localhost. */}
      {status === 'loading' && (
        <span className="h-4 w-56 animate-pulse rounded bg-canvas" aria-hidden="true" />
      )}
      {company && user && (
        <span>
          {company.name} · {user.email} · <Badge mono>{roleLabel(t, role ?? '')}</Badge>
        </span>
      )}
    </div>
  )
}
