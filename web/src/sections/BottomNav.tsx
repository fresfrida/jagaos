/** Mobile-only bottom navigation for the signed-in app (2026-09-23,
 * mobile-first header fix) — the real bug report: on a real Android phone
 * at 375px, the header's logo + five nav items + language selector +
 * email + Log Out all fought for one row and visibly overlapped/wrapped.
 * `Header.tsx`'s inline nav list now only renders from `sm:` up for a
 * signed-in visitor; this bar carries the same five destinations
 * (Calendar, Tags, Search, Company Files, Upload) below `sm` instead, one
 * per icon+label, matching the reference "raised center action" pattern
 * the task pointed at — Upload is the single most common action, so it
 * gets the visually prominent center "+"-style button while the other
 * four sit two-and-two around it (desktop's OPS_NAV_ROUTES order is
 * Calendar/Tags/Search/Company-Files/Upload; this only ever pulls Upload
 * out of its slot into the middle, the other four keep their relative
 * order). Rendered only when signed in — App.tsx also adds bottom padding
 * to <main> in that case so this bar never covers the last item.
 *
 * **Role-aware since 2026-09-23** (role/permission work): a viewer never
 * sees the raised center Upload button (they're already 403'd server-side
 * on upload) — the remaining four items reflow into one plain even row
 * instead. Company Settings, the new owner/admin-only page, isn't a sixth
 * slot here — reachable on mobile via the account menu instead
 * (Header.tsx's UserMenu).
 *
 * **Center button no longer a dead tap when already on /upload
 * (2026-09-23, live regression report item 5)** — it used to be a plain
 * <Link>, so tapping it while already on the page it navigates to did
 * nothing, next to the page's own working dropzone. Now opens the file
 * picker directly in that case instead (lib/uploadTrigger.ts). */

import { CalendarDays, FileText, Search, Tag, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../features/auth/AuthContext'
import { cn } from '../lib/cn'
import { triggerUploadPicker } from '../lib/uploadTrigger'
import { Link } from '../router/Link'
import { NAV_LABEL_KEYS, routeHref, type ResolvedRoute, type RouteId } from '../router/routes'

const LEFT_ROUTES: RouteId[] = ['calendar', 'tags']
const RIGHT_ROUTES: RouteId[] = ['search', 'company-files']
const CENTER_ROUTE: RouteId = 'upload'

// Reuses icons already imported elsewhere in this app (2026-09-23 ask:
// don't introduce a new icon set) — CalendarDays/Tag from
// components/RouteCta.tsx, Search from features/tags/TagsPreview.tsx,
// FileText from features/ops/DocumentCard.tsx, Upload from
// pages/UploadPage.tsx.
const ICONS: Record<RouteId, typeof CalendarDays> = {
  calendar: CalendarDays,
  tags: Tag,
  search: Search,
  'company-files': FileText,
  upload: Upload,
  home: CalendarDays,
  'how-it-works': CalendarDays,
  stack: CalendarDays,
  'get-started': CalendarDays,
  login: CalendarDays,
  ops: CalendarDays,
  // Never actually rendered by this bar (2026-09-23, role/permission
  // work) — Company Settings is reachable on mobile via UserMenu
  // (Header.tsx) instead, this bar has no room for a conditional sixth
  // slot. A filler value only, same as the other non-nav RouteIds above,
  // just satisfying Record<RouteId, ...>.
  'company-settings': CalendarDays,
}

function NavItem({ id, active }: { id: RouteId; active: boolean }) {
  const { t } = useTranslation()
  const Icon = ICONS[id]
  return (
    <Link
      href={routeHref(id)}
      aria-current={active ? 'page' : undefined}
      // 2026-09-23 (live regression report, item 9): more vertical room —
      // py-1.5 -> py-2.5, icon 20 -> 22 — the bar felt cramped on a real
      // phone. The raised center button below grows proportionally too.
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[11px] leading-none transition-colors',
        active ? 'text-ink' : 'text-muted',
      )}
    >
      <Icon size={22} strokeWidth={active ? 2.25 : 2} aria-hidden="true" />
      <span>{t(NAV_LABEL_KEYS[id] ?? '')}</span>
    </Link>
  )
}

export function BottomNav({ current }: { current: ResolvedRoute }) {
  const { t } = useTranslation()
  // Pulled directly from useAuth() (2026-09-23, role/permission work) —
  // same hook Header.tsx already uses, no new plumbing needed. A viewer
  // is already 403'd server-side on upload (app/auth.py's
  // require_role("user") on POST /api/documents), so the raised center
  // button — this app's single most prominent call to action — shouldn't
  // exist for a role that can never use it.
  const { role } = useAuth()
  const uploadActive = current === CENTER_ROUTE

  if (role === 'viewer') {
    // Simplest, least-surprising reflow (explicit call, not the only
    // option): the remaining four items as one plain even row, same
    // NavItem component, no raised center treatment.
    return (
      <nav
        aria-label={t('header.primaryNav')}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur-md sm:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto flex max-w-[520px] items-stretch">
          {[...LEFT_ROUTES, ...RIGHT_ROUTES].map((id) => <NavItem key={id} id={id} active={current === id} />)}
        </div>
      </nav>
    )
  }

  return (
    <nav
      aria-label={t('header.primaryNav')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur-md sm:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-[520px] items-stretch">
        {LEFT_ROUTES.map((id) => <NavItem key={id} id={id} active={current === id} />)}

        <div className="flex flex-1 flex-col items-center justify-center">
          {/* 2026-09-23 (live regression report, item 5): this used to be
             a plain <Link> — pure navigation, so tapping it while
             already on /upload did nothing, next to the page's own
             working dropzone. When already there, it now opens the file
             picker directly instead (lib/uploadTrigger.ts's window
             event, caught by UploadPage.tsx) rather than just navigating
             to the page it's already on. */}
          {/* 2026-09-23 (live regression report, item 9): grown proportionally
             with NavItem's own increase (h-12/-mt-5 -> h-14/-mt-6, icon
             20 -> 22) so the raised button doesn't shrink relative to the
             now-taller bar around it. */}
          {uploadActive ? (
            <button
              type="button"
              onClick={() => triggerUploadPicker()}
              aria-label={t(NAV_LABEL_KEYS[CENTER_ROUTE] ?? '')}
              className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-ink text-white shadow-md transition-colors"
            >
              <Upload size={22} aria-hidden="true" />
            </button>
          ) : (
            <Link
              href={routeHref(CENTER_ROUTE)}
              className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full border-4 border-white bg-sage text-white shadow-md transition-colors"
            >
              <Upload size={22} aria-hidden="true" />
            </Link>
          )}
          <span className={cn('mt-1 text-[11px] leading-none', uploadActive ? 'text-ink' : 'text-muted')}>
            {t(NAV_LABEL_KEYS[CENTER_ROUTE] ?? '')}
          </span>
        </div>

        {RIGHT_ROUTES.map((id) => <NavItem key={id} id={id} active={current === id} />)}
      </div>
    </nav>
  )
}
