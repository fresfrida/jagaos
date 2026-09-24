/** The site header. Signed out: logo, Calendar, Tags, language, Log In, Get
 * Started (the marketing header, unchanged). Signed in (2026-09-24, round 14,
 * DECISIONS #88), desktop:
 *
 *   [logo] Calendar  Company Files            language  company  (user)  [Upload]
 *
 * Five things beside the logo plus one button, nothing wraps, nothing overlaps
 * at any width from a phone to a wide desktop (measured, not assumed). Tags,
 * Search and Company Settings live in the user menu; the solid black Upload
 * button takes the slot Get Started had, and Get Started is gone once signed in.
 * On a phone the inline nav and the button are hidden: BottomNav carries the
 * destinations and its raised centre button is Upload. */

import { useTranslation } from 'react-i18next'
import { ButtonLink } from '../components/ui/ButtonLink'
import { Container } from '../components/ui/Container'
import { Logo } from '../components/ui/Logo'
import { useAuth } from '../features/auth/AuthContext'
import { CompanySwitcher } from '../features/auth/CompanySwitcher'
import { useScrolled } from '../hooks/useScrolled'
import { cn } from '../lib/cn'
import { SUPPORTED_LANGUAGES, setLanguage, type LanguageCode } from '../i18n'
import { Link } from '../router/Link'
import { NAV_LABEL_KEYS, SIGNED_IN_NAV_ROUTES, TAB_ROUTES, routeHref, type ResolvedRoute, type RouteId } from '../router/routes'
import { canOfferUpload } from './headerNav'
import { UserMenu } from './UserMenu'

/** Compact language switcher — a plain <select>, not a custom dropdown
 * widget, per the "keep the control itself simple" brief. Persists via
 * setLanguage (web/src/i18n.ts, localStorage) so the choice survives a
 * reload. */
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

function PrimaryNav({ routes, current, phoneHidden }: { routes: readonly RouteId[]; current: ResolvedRoute; phoneHidden: boolean }) {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('header.primaryNav')} className={phoneHidden ? 'hidden sm:block' : 'block'}>
      <ul className="flex items-center gap-0.5">
        {routes.map((id) => {
          const active = current === id
          return (
            <li key={id}>
              <Link
                href={routeHref(id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'block whitespace-nowrap rounded-md px-2.5 py-2 text-sm transition-colors sm:px-3',
                  // Same font weight in both states: a bolder active tab is wider and nudges its neighbour.
                  active ? 'bg-canvas text-ink' : 'text-muted hover:text-ink',
                )}
              >
                {t(NAV_LABEL_KEYS[id] ?? '')}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function Header({ current }: { current: ResolvedRoute }) {
  const scrolled = useScrolled()
  const { status, user, role } = useAuth()
  const { t } = useTranslation()
  const signedIn = status === 'signed-in' && user !== null

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b transition-colors duration-300',
        scrolled ? 'border-line bg-white/80 backdrop-blur-md' : 'border-transparent bg-white',
      )}
    >
      <Container className="flex h-16 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3 sm:gap-6">
          <Logo />
          <PrimaryNav routes={signedIn ? SIGNED_IN_NAV_ROUTES : TAB_ROUTES} current={current} phoneHidden={signedIn} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <LanguageSwitcher />
          {signedIn ? (
            <>
              {/* Inline from `lg`; narrower, the same control is in the user
                 menu (an inline select does not fit beside the rest). Renders
                 nothing for anyone with fewer than two companies. */}
              <CompanySwitcher className="hidden max-w-[170px] lg:block" />
              <UserMenu />
              {/* The single solid button, in the slot Get Started had. Not on
                 a phone (the bottom nav's centre button is Upload) and not for
                 a viewer (the server refuses their upload). */}
              {canOfferUpload(role) && (
                // A wrapper decides visibility: ButtonLink's own classes set
                // `display: inline-flex`, which a `hidden` on the link itself
                // does not reliably beat.
                <span className="hidden sm:block">
                  <ButtonLink
                    href={routeHref('upload')}
                    size="sm"
                    aria-current={current === 'upload' ? 'page' : undefined}
                    className="whitespace-nowrap"
                  >
                    {t(NAV_LABEL_KEYS.upload ?? '')}
                  </ButtonLink>
                </span>
              )}
            </>
          ) : (
            <>
              <Link href={routeHref('login')} className="whitespace-nowrap rounded-md px-2.5 py-2 text-sm font-medium text-ink sm:px-3">
                {t('header.logIn')}
              </Link>
              {/* Hidden on phones: it duplicates the Calendar tab and the row would not fit. */}
              <span className="hidden sm:block">
                <ButtonLink href={routeHref('calendar')} size="sm" className="whitespace-nowrap">
                  {t('header.getStarted')}
                </ButtonLink>
              </span>
            </>
          )}
        </div>
      </Container>
    </header>
  )
}
