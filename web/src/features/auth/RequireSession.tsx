/** Gates a page behind a real session: a loading placeholder, then, for a signed-out visitor, a redirect HOME (the landing
 * page, whose buttons open the demo picker; DECISIONS #106: it used to go to the bare /login form, a dead end for a visitor
 * with no account, and the header no longer links to it). Pulled out of OpsConsole's function body (2026-09-23, header/nav
 * restructure) so the same guard doesn't get copy-pasted into each of the routes promoted from its tabs. */

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
    if (status === 'signed-out') navigate(routeHref('home'))
  }, [status])

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted">
        <Loader2 size={16} className="animate-spin" /> {t('ops.session.checking')}
      </div>
    )
  }

  if (status === 'signed-out') {
    // The effect above is already redirecting home; this is what
    // renders for the one tick before that navigation completes.
    return <p className="py-16 text-sm text-muted">{t('ops.session.redirecting')}</p>
  }

  return <>{children}</>
}
