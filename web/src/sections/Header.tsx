/** The site header. Signed out (DECISIONS #106): the logo, the language select and, from `sm` up, one Get Started button that
 * opens the demo-account picker. There is no Log In and no Calendar / Tags tabs any more (the tabs led to sample-data pages
 * that are gone); on a phone the header is the logo and the language select, and the landing page carries the call to action.
 * Signed in, from `xl` (1280px):
 *
 *   [logo] Calendar  Search  Company Files  Only me      language  company  (user)  [Upload]
 *
 * The four pages a person opens all day are in the header itself; the account menu behind the avatar is who you are,
 * Company Settings (admin and owner) and Log Out. Which items show is decided by role (sections/headerNav.ts): Only me is for
 * user and above, Upload is not offered to a viewer. Narrower, in steps, because it does not fit (measured at 640, 768, 900,
 * 1024, 1280 and 1440px in four languages): from `lg` the same four items but the company switcher and the role chip move into
 * the account menu; from `sm` to `lg` only Calendar and Company Files stay inline and Search and Only me join the menu. On a phone the inline nav and the Upload button are hidden: BottomNav
 * carries the destinations and its raised centre button is Upload. */

import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { ButtonLink } from '../components/ui/ButtonLink'
import { Container } from '../components/ui/Container'
import { Logo } from '../components/ui/Logo'
import { useAuth } from '../features/auth/AuthContext'
import { CompanySwitcher } from '../features/auth/CompanySwitcher'
import { useScrolled } from '../hooks/useScrolled'
import { cn } from '../lib/cn'
import { SUPPORTED_LANGUAGES, setLanguage, type LanguageCode } from '../i18n'
import { openDemoPicker } from '../lib/demoPickerTrigger'
import { Link } from '../router/Link'
import { NAV_LABEL_KEYS, routeHref, type ResolvedRoute, type RouteId } from '../router/routes'
import { LG_ONLY_NAV_ROUTES, canOfferUpload, signedInNavRoutes } from './headerNav'
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
      className="rounded-md border border-line bg-white px-2 py-1.5 text-[14px] text-ink outline-none focus:border-ink"
    >
      {SUPPORTED_LANGUAGES.map((lang) => (
        <option key={lang.code} value={lang.code}>{lang.label}</option>
      ))}
    </select>
  )
}

/** The signed-in inline nav: from `sm` up only. On a phone a signed-in person has the bottom bar. */
function PrimaryNav({ routes, current }: { routes: readonly RouteId[]; current: ResolvedRoute }) {
  const { t } = useTranslation()
  return (
    <nav aria-label={t('header.primaryNav')} className="hidden sm:block">
      <ul className="flex items-center gap-0.5">
        {routes.map((id) => {
          const active = current === id
          return (
            // Search and Only me only fit from `lg`; below it they are in the account menu (headerNav.ts).
            <li key={id} className={LG_ONLY_NAV_ROUTES.includes(id) ? 'hidden lg:block' : undefined}>
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
          {signedIn && <PrimaryNav routes={signedInNavRoutes(role)} current={current} />}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <LanguageSwitcher />
          {signedIn ? (
            <>
              {/* Inline from `xl` (it was `lg` until four nav items needed the room); narrower, the same control is in the
                 user menu (an inline select does not fit beside the rest). Renders nothing for anyone with fewer than
                 two companies. */}
              <CompanySwitcher className="hidden max-w-[240px] xl:block" />
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
            /* Hidden on phones, as before: the landing page's own button is right under the header there, and the
               row stays the logo and the language select. */
            <span className="hidden sm:block">
              <Button size="sm" className="whitespace-nowrap" onClick={openDemoPicker} aria-haspopup="dialog">
                {t('header.getStarted')}
              </Button>
            </span>
          )}
        </div>
      </Container>
    </header>
  )
}
