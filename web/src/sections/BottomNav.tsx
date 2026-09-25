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
 * four sit two-and-two around it (the desktop nav's order was
 * Calendar/Tags/Search/Company-Files/Upload at the time; this only ever
 * pulls Upload out of its slot into the middle, the other four keep their
 * relative order. The desktop header has since shrunk to Calendar and
 * Company Files — round 14, DECISIONS #88 — and this bar is unchanged). Rendered only when signed in — App.tsx also adds bottom padding
 * to <main> in that case so this bar never covers the last item.
 *
 * **Role-aware since 2026-09-23** (role/permission work): a viewer never
 * sees the raised center Upload button (they're already 403'd server-side
 * on upload) — the remaining four items reflow into one plain even row
 * instead. Company Settings, the new owner/admin-only page, isn't a sixth
 * slot here — reachable on mobile via the account menu instead
 * (Header.tsx's UserMenu).
 *
 * **Round 16 (item 10c): the center button opens the Upload sheet on every
 * page** (features/upload/UploadSheetHost.tsx, lib/uploadTrigger.ts), a bottom
 * sheet with the DOCUMENT / PHOTO choice. It used to navigate to /upload, and only
 * when already there scroll to and focus the page's own choice (2026-09-23, item 5,
 * where it had been a dead tap next to the page's dropzone). Choosing in the sheet
 * hands the file to the Upload page, which uploads it.
 *
 * **Round 21 (A4, DECISIONS #101): every label is one line, and the five cells are the same width.** At 375px a
 * cell is 72px and "Company Files" (84px at 12px) wrapped to two lines, Tamil "Tags" was 77px and made its cell
 * wider than the others. Type stays at 12px (round 20's accessibility floor); instead the two labels that do not
 * fit have a SHORT form for this bar only (`header.navShort.*`: "Files", and Tamil's singular "Tags"), every label is
 * `whitespace-nowrap`, and the cells are `basis-0 min-w-0` so a long label can never resize its neighbours. The
 * desktop header keeps the full names.
 *
 * **DECISIONS #106: Only me takes the slot the Tags page left.** The Tags page is gone, so the left pair is Calendar and Only me
 * and the right pair is Search and Company Files, with Upload raised in the middle, still five cells and symmetric. Only me
 * is for user and above (a viewer gets a plain row of Calendar, Search and Company Files). It also stopped being an account-menu
 * entry, so this bar is the phone's way into it. */

import { CalendarDays, FileText, Lock, Search, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../features/auth/AuthContext'
import { cn } from '../lib/cn'
import { openUploadSheet } from '../lib/uploadTrigger'
import { Link } from '../router/Link'
import { NAV_LABEL_KEYS, routeHref, type ResolvedRoute, type RouteId } from '../router/routes'
import { canUsePrivateSpace } from './headerNav'

/** The space a signed-in page must leave at its end on a phone so the fixed bar (and its raised Upload button, which rises
 * above the bar) never covers the last line: 6.5rem plus the same safe-area inset the bar adds to ITS height, so the two cannot
 * drift apart (round 14 recorded 47px of clearance to the raised button; on the footer in DECISIONS #106 the last line measures 29px above the button and 47px above the bar). It is applied to the FOOTER,
 * the last thing on every page (sections/Footer.tsx), and `sm:` up the bar does not exist. */
export const PHONE_BOTTOM_NAV_CLEARANCE = 'max-sm:pb-[calc(6.5rem+env(safe-area-inset-bottom))]'

const LEFT_ROUTES: RouteId[] = ['calendar', 'only-me']
const RIGHT_ROUTES: RouteId[] = ['search', 'company-files']
const CENTER_ROUTE: RouteId = 'upload'

// The bar's own wording where the full nav name is too wide for a 72px cell (see the docstring); every other item
// uses its full name. A visible short label keeps the full name as its accessible name when it contains it.
const SHORT_LABEL_KEYS: Partial<Record<RouteId, string>> = {
  'only-me': 'header.navShort.onlyMe', // Tamil and Malay are too wide for a cell at 375/320 (DECISIONS #106); en and zh equal the full name
  'company-files': 'header.navShort.companyFiles',
}

// Reuses icons already used elsewhere in this app (2026-09-23 ask: don't introduce a new icon set): CalendarDays,
// Search, FileText from features/ops/DocumentCard.tsx, Upload from pages/UploadPage.tsx, Lock from the Only me card on
// the signed-in home (pages/SignedInHome.tsx).
const ICONS: Record<RouteId, typeof CalendarDays> = {
  calendar: CalendarDays,
  'only-me': Lock,
  search: Search,
  'company-files': FileText,
  upload: Upload,
  home: CalendarDays,
  'how-it-works': CalendarDays,
  stack: CalendarDays,
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
  const full = t(NAV_LABEL_KEYS[id] ?? '')
  const label = SHORT_LABEL_KEYS[id] ? t(SHORT_LABEL_KEYS[id]) : full
  return (
    <Link
      href={routeHref(id)}
      aria-current={active ? 'page' : undefined}
      aria-label={full !== label && full.toLowerCase().includes(label.toLowerCase()) ? full : undefined}
      // 2026-09-23 (live regression report, item 9): more vertical room —
      // py-1.5 -> py-2.5, icon 20 -> 22 — the bar felt cramped on a real
      // phone. The raised center button below grows proportionally too.
      className={cn(
        'flex min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 py-2.5 text-[12px] leading-none transition-colors',
        active ? 'text-ink' : 'text-muted',
      )}
    >
      <Icon size={22} strokeWidth={active ? 2.25 : 2} aria-hidden="true" />
      <span className="whitespace-nowrap">{label}</span>
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
  const leftRoutes = LEFT_ROUTES.filter((id) => id !== 'only-me' || canUsePrivateSpace(role))

  if (role === 'viewer') {
    // Simplest, least-surprising reflow (explicit call, not the only
    // option): the remaining items (Calendar, Search, Company Files) as
    // one plain even row, same NavItem component, no raised center treatment.
    return (
      <nav
        aria-label={t('header.primaryNav')}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur-md sm:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto flex max-w-[520px] items-stretch">
          {[...leftRoutes, ...RIGHT_ROUTES].map((id) => <NavItem key={id} id={id} active={current === id} />)}
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
        {leftRoutes.map((id) => <NavItem key={id} id={id} active={current === id} />)}

        <div className="flex min-w-0 flex-1 basis-0 flex-col items-center justify-center">
          {/* Round 16 (item 10c): always opens the Upload sheet, on every page. It used
             to navigate to /upload, and only when already there scrolled to and
             focused the page's own choice (2026-09-23, item 5: it had been a dead tap
             next to the page's dropzone). One bottom sheet with the DOCUMENT / PHOTO
             choice now does the same job everywhere, this page included; a file
             chosen in it is handed to the Upload page (UploadSheetHost).
             2026-09-23 (item 9): h-14/-mt-6, icon 22, grown with NavItem's own size. */}
          <button
            type="button"
            onClick={() => openUploadSheet()}
            aria-label={t(NAV_LABEL_KEYS[CENTER_ROUTE] ?? '')}
            aria-haspopup="dialog"
            className={cn(
              '-mt-6 flex h-14 w-14 items-center justify-center rounded-full border-4 border-white text-white shadow-md transition-colors',
              uploadActive ? 'bg-ink' : 'bg-sage',
            )}
          >
            <Upload size={22} aria-hidden="true" />
          </button>
          <span className={cn('mt-1 whitespace-nowrap text-[12px] leading-none', uploadActive ? 'text-ink' : 'text-muted')}>
            {t(NAV_LABEL_KEYS[CENTER_ROUTE] ?? '')}
          </span>
        </div>

        {RIGHT_ROUTES.map((id) => <NavItem key={id} id={id} active={current === id} />)}
      </div>
    </nav>
  )
}
