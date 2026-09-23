import { CircleUserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../components/ui/Badge'
import { Container } from '../components/ui/Container'
import { ButtonLink } from '../components/ui/ButtonLink'
import { Logo } from '../components/ui/Logo'
import { useAuth } from '../features/auth/AuthContext'
import { useScrolled } from '../hooks/useScrolled'
import { cn } from '../lib/cn'
import { SUPPORTED_LANGUAGES, setLanguage, type LanguageCode } from '../i18n'
import { navigate } from '../router/navigate'
import { Link } from '../router/Link'
import { NAV_LABEL_KEYS, OPS_NAV_ROUTES, TAB_ROUTES, routeHref, type ResolvedRoute } from '../router/routes'

/** Compact language switcher — a plain <select>, not a custom dropdown
 * widget, per the "keep the control itself simple" brief. Persists via
 * setLanguage (web/src/i18n.ts, localStorage) so the choice survives a
 * reload. zh/ta/ms now hold real Chinese/Malay/Tamil translations (see
 * i18n.ts's own docstring) — DECISIONS #57 shipped them as English-value
 * stubs first, superseded once the real translations landed. */
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

/** Collapses company/email/role + Log Out behind one button on phones
 * (2026-09-23, mobile-first header fix) — there is no room to spell out
 * "Try Demo Pte Ltd · owner@… · OWNER · Log Out" as flat text at 375px,
 * confirmed by a real Android Chrome screenshot where the top bar's items
 * overlapped. Desktop keeps the existing inline email + Log Out
 * (`sm:hidden` on this component's own wrapper in Header below) —
 * unchanged there, this is additive for small screens only. Same
 * click-outside-closes pattern as `DocumentCard.tsx`'s overflow menu. */
function UserMenu() {
  const { t } = useTranslation()
  const { user, company, role, logout } = useAuth()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onDocClick = () => setOpen(false)
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [open])

  if (!user) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        aria-label={t('header.accountMenu')}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted hover:border-ink/40 hover:text-ink"
      >
        <CircleUserRound size={19} />
      </button>
      {open && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-card border border-line bg-white py-2 shadow-lg"
        >
          <div className="border-b border-line px-3 pb-2">
            {company && <p className="truncate text-[13px] font-medium text-ink">{company.name}</p>}
            <p className="truncate text-[12px] text-muted">{user.email}</p>
            {role && <Badge mono className="mt-1">{role}</Badge>}
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void logout().then(() => navigate(routeHref('home')))
            }}
            className="block w-full px-3 pt-2 text-left text-[13px] text-ink hover:bg-canvas"
          >
            {t('header.logOut')}
          </button>
        </div>
      )}
    </div>
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
          {/* Signed-in: the bottom nav (BottomNav.tsx) carries these five
             items on phones, so the inline list only needs to render from
             sm: up. Signed-out: just two items (Calendar, Tags), light
             enough to keep inline at every width — no bottom nav exists
             for the logged-out marketing pages. */}
          <nav aria-label={t('header.primaryNav')} className={status === 'signed-in' ? 'hidden sm:block' : 'block'}>
            <ul className="flex items-center gap-0.5">
              {/* Signed-in nav is the five real-app items in their
                 specified order; Calendar/Tags are the same two paths as
                 the logged-out marketing nav (Page.tsx branches on
                 session state to decide what renders at each). */}
              {(status === 'signed-in' ? OPS_NAV_ROUTES : TAB_ROUTES).map((id) => {
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
                      {t(NAV_LABEL_KEYS[id] ?? '')}
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
              <Link href={routeHref('upload')} className="hidden truncate text-[13px] text-muted sm:block sm:max-w-[160px]">
                {user.name || user.email}
              </Link>
              <button
                onClick={() => void logout().then(() => navigate(routeHref('home')))}
                className="hidden rounded-md px-2.5 py-2 text-sm font-medium text-ink sm:block sm:px-3"
              >
                {t('header.logOut')}
              </button>
              <span className="sm:hidden">
                <UserMenu />
              </span>
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
