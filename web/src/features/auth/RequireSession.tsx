/** Gates a page behind a real session — shows a loading placeholder, then
 * redirects to /login if there's no session. Pulled out of OpsConsole's
 * function body (2026-09-23, header/nav restructure) so the same guard
 * doesn't get copy-pasted into each of the 5 routes promoted from its
 * tabs — every one of them wraps its content in this instead. */

import { Loader2 } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { navigate } from '../../router/navigate'
import { routeHref } from '../../router/routes'
import { useAuth } from './AuthContext'

export function RequireSession({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { status } = useAuth()

  useEffect(() => {
    if (status === 'signed-out') navigate(routeHref('login'))
  }, [status])

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted">
        <Loader2 size={16} className="animate-spin" /> {t('ops.session.checking')}
      </div>
    )
  }

  if (status === 'signed-out') {
    // The effect above is already redirecting to /login; this is what
    // renders for the one tick before that navigation completes.
    return <p className="py-16 text-sm text-muted">{t('ops.session.redirecting')}</p>
  }

  return <>{children}</>
}
