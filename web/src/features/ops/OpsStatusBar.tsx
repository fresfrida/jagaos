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

export function OpsStatusBar({ apiUp }: { apiUp?: boolean | null }) {
  const { t } = useTranslation()
  const { company, user, role } = useAuth()

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
      {company && user && (
        <span>
          {company.name} · {user.email} · <Badge mono>{role}</Badge>
        </span>
      )}
    </div>
  )
}
