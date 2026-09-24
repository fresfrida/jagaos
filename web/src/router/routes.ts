import { PRODUCT_NAME } from '../config/product'

/** Real URL paths (/calendar), served by the SPA fallback on Vite, Caddy and Vercel (see web/vercel.json). */
export type RouteId =
  | 'home' | 'calendar' | 'tags' | 'how-it-works' | 'stack' | 'get-started' | 'login' | 'ops'
  | 'upload' | 'company-files' | 'search' | 'company-settings' | 'only-me'
export type ResolvedRoute = RouteId | 'not-found'
/** Pages that share the title + content layout. */
export type FrameRouteId =
  | 'calendar' | 'tags' | 'how-it-works' | 'stack' | 'ops' | 'upload' | 'company-files' | 'search' | 'company-settings' | 'only-me'

export interface RouteConfig {
  path: string
  title: string
  description?: string
  // Optional i18n overrides (2026-09-23, header/nav restructure): when
  // present, FramePage prefers these over the plain `title`/`description`
  // above. Kept optional rather than required on every route so the
  // pre-existing frame routes (calendar/tags/how-it-works/stack/ops),
  // whose static English title/description predate this task, don't need
  // touching just to add three new routes.
  titleKey?: string
  descriptionKey?: string
}

export const ROUTES: Record<RouteId, RouteConfig> = {
  home: { path: '/', title: 'Home' },
  calendar: {
    path: '/calendar',
    title: 'Calendar',
    description: 'Events and deadlines, with the documents, decisions and people behind them.',
  },
  tags: {
    path: '/tags',
    title: 'Tags',
    description: 'Memories filtered by the tags your team uses, each with its sources.',
  },
  'how-it-works': { path: '/how-it-works', title: 'How it works' },
  stack: {
    path: '/stack',
    title: 'One job for every layer',
    description: 'A small, auditable stack: each part has a single responsibility.',
  },
  'get-started': { path: '/get-started', title: 'Get started' },
  login: { path: '/login', title: 'Log in' },
  // Legacy path, kept as a redirect to /upload (2026-09-23) rather than
  // removed outright — the deployed app has been the single URL every
  // bookmark/phone-home-screen shortcut points at since 2026-09-22
  // (DECISIONS #32), so a dead 404 here would break those silently.
  ops: {
    path: '/ops',
    title: 'Your documents',
    description: 'Add a document, watch it get classified and extracted, confirm anything flagged, and see the obligations and gaps it produces.',
  },
  upload: { path: '/upload', title: 'Upload', titleKey: 'ops.tabs.review' },
  'company-files': { path: '/company-files', title: 'Company Files', titleKey: 'ops.companyFiles.heading' },
  search: { path: '/search', title: 'Search', titleKey: 'ops.search.heading' },
  'company-settings': { path: '/company-settings', title: 'Company Settings', titleKey: 'companySettings.heading' },
  // Round 19 (DECISIONS #94): the person's private space, in the account menu (user and above).
  'only-me': { path: '/only-me', title: 'Only me', titleKey: 'onlyMe.heading', descriptionKey: 'onlyMe.description' },
}

/** The logged-out header's nav tabs, in order. */
export const TAB_ROUTES = ['calendar', 'tags'] as const

/** The signed-in DESKTOP header's inline nav (round 14, DECISIONS #88): only
 * the two pages people open all day. It used to be Calendar, Tags, Search,
 * Company Files and Upload (plus Company Settings for admin/owner) — six items
 * that overlapped the language select and the call-to-action between ~640 and
 * ~900px. Calendar and Company Files are the same paths as before (Calendar's
 * content differs by session — DECISIONS #59); the rest moved into the account
 * menu (ACCOUNT_MENU_ROUTES) and Upload became the header's one solid button.
 * The mobile bottom nav (BottomNav.tsx) keeps its own five destinations. */
export const SIGNED_IN_NAV_ROUTES = ['calendar', 'company-files'] as const

/** Pages the account menu links to on desktop (round 14), for everyone
 * signed in. Company Settings is added for admin and owner by
 * sections/headerNav.ts::accountMenuRoutes. */
export const ACCOUNT_MENU_ROUTES = ['tags', 'search'] as const

/** Translated label per signed-in nav item, shared by the desktop header
 * (`Header.tsx`) and the mobile bottom nav (`BottomNav.tsx`, 2026-09-23
 * mobile-first header fix) so the two surfaces can't drift out of sync —
 * the logged-out marketing nav's Calendar/Tags share the same two ids, so
 * they're included here too rather than left reading from
 * ROUTES[id].title (untranslated). */
export const NAV_LABEL_KEYS: Partial<Record<RouteId, string>> = {
  calendar: 'header.nav.calendar',
  tags: 'header.nav.tags',
  search: 'header.nav.search',
  'company-files': 'header.nav.companyFiles',
  upload: 'header.nav.upload',
  'company-settings': 'header.nav.companySettings',
  'only-me': 'header.nav.onlyMe',
}

export const routeHref = (id: RouteId): string => ROUTES[id].path

/** Trailing slashes are ignored. Unknown paths are 'not-found'. */
export function parsePath(pathname: string): ResolvedRoute {
  const path = pathname.replace(/\/+$/, '') || '/'
  const ids = Object.keys(ROUTES) as RouteId[]
  return ids.find((id) => ROUTES[id].path === path) ?? 'not-found'
}

/** The home page's tab title, exactly as asked (2026-09-24, round 14) — a
 * literal, not derived from PRODUCT_NAME or a route title. index.html carries
 * the same string so the tab reads right before the app has loaded. */
export const HOME_TITLE = 'JagaOS, a Show Me Your Agents project'

/** The browser tab title: always "JagaOS: PageName", never "PageName - JagaOS"
 * (round 14). The page name is the route's static English title, as before. */
export function pageTitle(route: ResolvedRoute): string {
  if (route === 'home') return HOME_TITLE
  if (route === 'not-found') return `${PRODUCT_NAME}: Page not found`
  return `${PRODUCT_NAME}: ${ROUTES[route].title}`
}
