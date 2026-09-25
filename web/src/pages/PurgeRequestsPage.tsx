/** The owner's pending purge requests: /company-settings/purge-requests (round 3, item 9c, DECISIONS #121). They used to sit at the
 * bottom of Company Settings under the compliance checklist; this is a page of its own, linked from Company Settings. Owner only,
 * like the endpoint behind it: an admin (who can open Company Settings, read-only) is sent back there, and anyone lower is sent on
 * from it to the Calendar, exactly as they are for Company Settings itself. */

import { ChevronLeft } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../features/auth/AuthContext'
import { RequireSession } from '../features/auth/RequireSession'
import { PurgeRequestsSection } from '../features/company/PurgeRequestsSection'
import { Link } from '../router/Link'
import { navigate } from '../router/navigate'
import { routeHref } from '../router/routes'

function PurgeRequestsContent() {
  const { t } = useTranslation()
  const { role } = useAuth()
  const isOwner = role === 'owner'

  useEffect(() => {
    if (role !== null && !isOwner) navigate(routeHref('company-settings'))
  }, [role, isOwner])

  if (role !== null && !isOwner) return <p className="py-16 text-sm text-muted">{t('ops.session.redirecting')}</p>

  return (
    // The same one centred column as Company Settings (DECISIONS #111), so the two pages line up.
    <div className="mx-auto w-full max-w-2xl" data-testid="purge-requests-column">
      <Link
        href={routeHref('company-settings')}
        className="mb-6 inline-flex min-h-[44px] items-center gap-1 text-[14px] text-muted hover:text-ink"
      >
        <ChevronLeft size={16} aria-hidden="true" />
        {t('companySettings.purgeRequests.back')}
      </Link>
      <PurgeRequestsSection enabled={isOwner} />
    </div>
  )
}

export function PurgeRequestsPage() {
  return (
    <RequireSession>
      <PurgeRequestsContent />
    </RequireSession>
  )
}
