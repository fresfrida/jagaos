/** The signed-in account menu — the one user-menu pattern at every width (2026-09-24, round 14, DECISIONS #88; cut down by
 * DECISIONS #106). Calendar, Search, Company Files and Only me are in the header itself now, and the Tags page is gone, so
 * the menu holds: who you are (company, email, role); the company switcher below `xl` (from `xl` it sits inline in the header,
 * so it is not repeated here); between `sm` and `lg` only, Search and Only me (the header has no room for them there, and a
 * phone's bottom bar carries them); Company Settings for admin and owner; Log Out. Same click-outside-closes pattern as
 * DocumentCard's overflow menu. */

import { CircleUserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../components/ui/Badge'
import { useAuth } from '../features/auth/AuthContext'
import { CompanySwitcher } from '../features/auth/CompanySwitcher'
import { roleLabel } from '../features/ops/opsShared'
import { navigate } from '../router/navigate'
import { Link } from '../router/Link'
import { NAV_LABEL_KEYS, routeHref } from '../router/routes'
import { accountMenuRoutes, narrowWidthMenuRoutes } from './headerNav'

const MENU_ITEM_CLASS = 'block w-full px-3 py-1.5 text-left text-[14px] text-ink hover:bg-canvas'

export function UserMenu() {
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
  const menuRoutes = accountMenuRoutes(role)
  const narrowRoutes = narrowWidthMenuRoutes(role)

  return (
    <div className="relative flex items-center gap-1.5">
      {/* The role at a glance, beside the avatar (2026-09-23): on phones and
         from `xl` (it was `lg` before the header carried four nav items). Between
         them there is no room in the header, and the menu's own header repeats it. */}
      {/* 'inverted' (round 4, item 7, DECISIONS #122): this instance sits on the dark header bar; the copy inside the dropdown
         below keeps the default 'neutral' tone, since that panel is still white. */}
      {role && <Badge mono tone="inverted" className="max-xl:hidden max-sm:inline-flex">{roleLabel(t, role)}</Badge>}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        aria-label={t('header.accountMenu')}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/25 text-white/80 hover:border-white/50 hover:text-white"
      >
        <CircleUserRound size={19} />
      </button>
      {open && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-card border border-line bg-white py-2 shadow-lg"
        >
          <div className="border-b border-line px-3 pb-2">
            {company && <p className="truncate text-[14px] font-medium text-ink">{company.name}</p>}
            <p className="truncate text-[13px] text-muted">{user.email}</p>
            {role && <Badge mono className="mt-1">{roleLabel(t, role)}</Badge>}
          </div>
          {/* Renders nothing for anyone with fewer than two companies. */}
          <CompanySwitcher className="border-b border-line px-3 py-2 xl:hidden" />
          {narrowRoutes.length > 0 && (
            <div className="hidden py-1 sm:block lg:hidden" data-testid="menu-narrow-routes">
              {narrowRoutes.map((id) => (
                <Link key={id} href={routeHref(id)} role="menuitem" onClick={() => setOpen(false)} className={MENU_ITEM_CLASS}>
                  {t(NAV_LABEL_KEYS[id] ?? '')}
                </Link>
              ))}
            </div>
          )}
          {menuRoutes.length > 0 && (
            <div className="py-1">
              {menuRoutes.map((id) => (
                <Link key={id} href={routeHref(id)} role="menuitem" onClick={() => setOpen(false)} className={MENU_ITEM_CLASS}>
                  {t(NAV_LABEL_KEYS[id] ?? '')}
                </Link>
              ))}
            </div>
          )}
          <div className="border-t border-line pt-1">
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false)
                void logout().then(() => navigate(routeHref('home')))
              }}
              className={MENU_ITEM_CLASS}
            >
              {t('header.logOut')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
