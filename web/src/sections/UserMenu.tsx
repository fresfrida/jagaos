/** The signed-in account menu — the one user-menu pattern at every width
 * (2026-09-24, round 14, DECISIONS #88). It used to exist only on phones (and
 * below 1280px for someone with several companies); desktop showed the name and
 * Log Out inline instead. With Tags, Search and Company Settings moved out of
 * the desktop nav, this is where they live, next to Log Out.
 *
 * Contents, top to bottom: who you are (company, email, role); the company
 * switcher below `lg` (from `lg` it sits inline in the header, so it is not
 * repeated here); Tags and Search from `sm` up (a phone's bottom nav already
 * carries them); Company Settings for admin and owner; Log Out. Same
 * click-outside-closes pattern as DocumentCard's overflow menu. */

import { CircleUserRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '../components/ui/Badge'
import { useAuth } from '../features/auth/AuthContext'
import { CompanySwitcher } from '../features/auth/CompanySwitcher'
import { roleLabel } from '../features/ops/opsShared'
import { navigate } from '../router/navigate'
import { Link } from '../router/Link'
import { NAV_LABEL_KEYS, routeHref, type RouteId } from '../router/routes'
import { accountMenuRoutes } from './headerNav'

/** Tags and Search are also in the phone's bottom nav, so the menu only lists
 * them from `sm` up. Company Settings has no bottom-nav slot and shows always. */
const PHONE_HAS_ITS_OWN: readonly RouteId[] = ['tags', 'search']

const MENU_ITEM_CLASS = 'block w-full px-3 py-1.5 text-left text-[13px] text-ink hover:bg-canvas'

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

  return (
    <div className="relative flex items-center gap-1.5">
      {/* The role at a glance, beside the avatar (2026-09-23): on phones and
         from `lg`. Between them there is no room in the header, and the menu's
         own header repeats it. */}
      {role && <Badge mono className="max-lg:hidden max-sm:inline-flex">{roleLabel(t, role)}</Badge>}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        aria-label={t('header.accountMenu')}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-muted hover:border-ink/40 hover:text-ink"
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
            {company && <p className="truncate text-[13px] font-medium text-ink">{company.name}</p>}
            <p className="truncate text-[12px] text-muted">{user.email}</p>
            {role && <Badge mono className="mt-1">{roleLabel(t, role)}</Badge>}
          </div>
          {/* Renders nothing for anyone with fewer than two companies. */}
          <CompanySwitcher className="border-b border-line px-3 py-2 lg:hidden" />
          <div className="py-1">
            {accountMenuRoutes(role).map((id) => (
              <Link
                key={id}
                href={routeHref(id)}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`${MENU_ITEM_CLASS} ${PHONE_HAS_ITS_OWN.includes(id) ? 'max-sm:hidden' : ''}`}
              >
                {t(NAV_LABEL_KEYS[id] ?? '')}
              </Link>
            ))}
          </div>
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
