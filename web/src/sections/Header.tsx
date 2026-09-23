import { useTranslation } from 'react-i18next'
import { Container } from '../components/ui/Container'
import { ButtonLink } from '../components/ui/ButtonLink'
import { Logo } from '../components/ui/Logo'
import { useAuth } from '../features/auth/AuthContext'
import { useScrolled } from '../hooks/useScrolled'
import { cn } from '../lib/cn'
import { SUPPORTED_LANGUAGES, setLanguage, type LanguageCode } from '../i18n'
import { navigate } from '../router/navigate'
import { Link } from '../router/Link'
import { ROUTES, TAB_ROUTES, routeHref, type ResolvedRoute } from '../router/routes'

/** Compact language switcher — a plain <select>, not a custom dropdown
 * widget, per the "keep the control itself simple" brief. Persists via
 * setLanguage (web/src/i18n.ts, localStorage) so the choice survives a
 * reload; zh/ta/ms are English-value stubs for now (2026-09-23) — real
 * translations are a separate, deferred follow-up task. */
function LanguageSwitcher() {
  const { i18n, t } = useTranslation()
  return (
    <select
      value={i18n.language}
      onChange={(e) => setLanguage(e.target.value as LanguageCode)}
      aria-label={t('header.language')}
      className="rounded-md border border-line bg-white px-2 py-1.5 text-[13px] text-ink outline-none focus:border-ink"
    >
      {SUPPORTED_LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>{lang.label}</option>
      ))}
    </select>
  )
}

export function Header({ current }: { current: ResolvedRoute }) {
  const scrolled = useScrolled()
  const { status, user, logout } = useAuth()
  const { t } = useTranslation()

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b transition-colors duration-300',
        scrolled ? 'border-line bg-white/80 backdrop-blur-md' : 'border-transparent bg-white',
      )}
    >
      <Container className="flex h-16 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3 sm:gap-8">
          <Logo />
          <nav aria-label={t('header.primaryNav')}>
            <ul className="flex items-center gap-0.5">
              {TAB_ROUTES.map((id) => {
                const active = current === id
                return (
                  <li key={id}>
                    <Link
                      href={routeHref(id)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'rounded-md px-2.5 py-2 text-sm transition-colors sm:px-3',
                        // Same font weight in both states: a bolder active tab is wider and nudges its neighbour.
                        active ? 'bg-canvas text-ink' : 'text-muted hover:text-ink',
                      )}
                    >
                      {ROUTES[id].title}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <LanguageSwitcher />
          {status === 'signed-in' && user ? (
            <>
              <Link href={routeHref('ops')} className="hidden truncate text-[13px] text-muted sm:block sm:max-w-[160px]">
                {user.name || user.email}
              </Link>
              <button
                onClick={() => void logout().then(() => navigate(routeHref('home')))}
                className="rounded-md px-2.5 py-2 text-sm font-medium text-ink sm:px-3"
              >
                {t('header.logOut')}
              </button>
            </>
          ) : (
            <Link href={routeHref('login')} className="rounded-md px-2.5 py-2 text-sm font-medium text-ink sm:px-3">
              {t('header.logIn')}
            </Link>
          )}
          {/* Hidden on phones: it duplicates the Calendar tab and the row would not fit. */}
          <span className="hidden sm:block">
            <ButtonLink href={routeHref('calendar')} size="sm">
              {t('header.getStarted')}
            </ButtonLink>
          </span>
        </div>
      </Container>
    </header>
  )
}
