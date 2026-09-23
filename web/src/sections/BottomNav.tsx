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
 * to <main> in that case so this bar never covers the last item. */

import { CalendarDays, FileText, Search, Tag, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../lib/cn'
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
}

function NavItem({ id, active }: { id: RouteId; active: boolean }) {
  const { t } = useTranslation()
  const Icon = ICONS[id]
  return (
    <Link
      href={routeHref(id)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] leading-none transition-colors',
        active ? 'text-ink' : 'text-muted',
      )}
    >
      <Icon size={20} strokeWidth={active ? 2.25 : 2} aria-hidden="true" />
      <span>{t(NAV_LABEL_KEYS[id] ?? '')}</span>
    </Link>
  )
}

export function BottomNav({ current }: { current: ResolvedRoute }) {
  const { t } = useTranslation()
  const uploadActive = current === CENTER_ROUTE

  return (
    <nav
      aria-label={t('header.primaryNav')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur-md sm:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto flex max-w-[520px] items-stretch">
        {LEFT_ROUTES.map((id) => <NavItem key={id} id={id} active={current === id} />)}

        <div className="flex flex-1 flex-col items-center justify-center">
          <Link
            href={routeHref(CENTER_ROUTE)}
            aria-current={uploadActive ? 'page' : undefined}
            className={cn(
              '-mt-5 flex h-12 w-12 items-center justify-center rounded-full border-4 border-white shadow-md transition-colors',
              uploadActive ? 'bg-ink text-white' : 'bg-sage text-white',
            )}
          >
            <Upload size={20} aria-hidden="true" />
          </Link>
          <span className={cn('mt-0.5 text-[11px] leading-none', uploadActive ? 'text-ink' : 'text-muted')}>
            {t(NAV_LABEL_KEYS[CENTER_ROUTE] ?? '')}
          </span>
        </div>

        {RIGHT_ROUTES.map((id) => <NavItem key={id} id={id} active={current === id} />)}
      </div>
    </nav>
  )
}
