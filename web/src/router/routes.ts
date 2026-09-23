import { PRODUCT_NAME } from '../config/product'

/** Real URL paths (/calendar), served by the SPA fallback on Vite, Caddy and Vercel (see web/vercel.json). */
export type RouteId =
  | 'home' | 'calendar' | 'tags' | 'how-it-works' | 'stack' | 'get-started' | 'login' | 'ops'
  | 'upload' | 'company-files' | 'search' | 'company-settings'
export type ResolvedRoute = RouteId | 'not-found'
/** Pages that share the title + content layout. */
export type FrameRouteId =
  | 'calendar' | 'tags' | 'how-it-works' | 'stack' | 'ops' | 'upload' | 'company-files' | 'search' | 'company-settings'

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
}

/** The logged-out header's nav tabs, in order. */
export const TAB_ROUTES = ['calendar', 'tags'] as const

/** The logged-in header's nav, in order (2026-09-23, header/nav
 * restructure): Calendar and Tags are the same two paths as the
 * logged-out nav above — same URL, different content once signed in
 * (Page.tsx branches on session state) — plus the three routes promoted
 * from OpsConsole's remaining tabs. */
export const OPS_NAV_ROUTES = ['calendar', 'tags', 'search', 'company-files', 'upload'] as const

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
}

export const routeHref = (id: RouteId): string => ROUTES[id].path

/** Trailing slashes are ignored. Unknown paths are 'not-found'. */
export function parsePath(pathname: string): ResolvedRoute {
  const path = pathname.replace(/\/+$/, '') || '/'
  const ids = Object.keys(ROUTES) as RouteId[]
  return ids.find((id) => ROUTES[id].path === path) ?? 'not-found'
}

export function pageTitle(route: ResolvedRoute): string {
  if (route === 'home') return `${PRODUCT_NAME} — company memory for growing teams`
  if (route === 'not-found') return `Page not found — ${PRODUCT_NAME}`
  return `${ROUTES[route].title} — ${PRODUCT_NAME}`
}
