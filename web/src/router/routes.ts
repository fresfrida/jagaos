import { PRODUCT_NAME } from '../config/product'

/** Real URL paths (/calendar), served by the SPA fallback on Vite, Caddy and Vercel (see web/vercel.json). */
export type RouteId =
  | 'home' | 'calendar' | 'how-it-works' | 'stack' | 'login' | 'ops'
  | 'upload' | 'company-files' | 'search' | 'company-settings' | 'purge-requests' | 'only-me'
export type ResolvedRoute = RouteId | 'not-found'
/** Pages that share the title + content layout. */
export type FrameRouteId =
  | 'calendar' | 'how-it-works' | 'stack' | 'ops' | 'upload' | 'company-files' | 'search' | 'company-settings' | 'purge-requests' | 'only-me'

export interface RouteConfig {
  path: string
  title: string
  description?: string
  // Optional i18n overrides (2026-09-23, header/nav restructure): when
  // present, FramePage prefers these over the plain `title`/`description`
  // above. Kept optional rather than required on every route so the
  // pre-existing frame routes (calendar/how-it-works/stack/ops),
  // whose static English title/description predate this task, don't need
  // touching just to add three new routes.
  titleKey?: string
  descriptionKey?: string
}

export const ROUTES: Record<RouteId, RouteConfig> = {
  home: { path: '/', title: 'Home' },
  // The subtitle is translated (DECISIONS #108): titleKey/descriptionKey, like the other app pages. `title`/`description` stay the
  // English fallbacks, and `title` is still what the browser tab shows.
  calendar: {
    path: '/calendar',
    title: 'Calendar',
    description: 'Your documents, by date.',
    titleKey: 'header.nav.calendar',
    descriptionKey: 'ops.calendar.description',
  },
  'how-it-works': { path: '/how-it-works', title: 'How it works' },
  stack: {
    path: '/stack',
    title: 'One job for every layer',
    description: 'A small, auditable stack: each part has a single responsibility.',
  },
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
  // Round 3, item 9c (DECISIONS #121): the owner's pending purge requests, a page of their own under Company Settings, linked from it.
  'purge-requests': {
    path: '/company-settings/purge-requests',
    title: 'Purge requests',
    titleKey: 'companySettings.purgeRequests.title',
    descriptionKey: 'companySettings.purgeRequests.description',
  },
  // Round 19 (DECISIONS #94): the person's private space, in the account menu (user and above).
  'only-me': { path: '/only-me', title: 'Only me', titleKey: 'onlyMe.heading', descriptionKey: 'onlyMe.description' },
}

/** Signed-in pages that FILL the viewport at desktop width (from `lg`), so their footer is at the bottom of the screen and their content
 * is centred between the header and the footer, with no scrolling (DECISIONS #109). Only the signed-in home, a short hub. Every other
 * page keeps the general rule (DECISIONS #108): `<main>` is as tall as its content and the footer sits directly under it. App.tsx reads
 * this; no page sets its own height. */
export const FIT_VIEWPORT_ROUTES: readonly RouteId[] = ['home']

/** The signed-in DESKTOP header's inline nav, in order (DECISIONS #106): the four pages a person opens all day. Round 14
 * (DECISIONS #88) had shrunk it to Calendar and Company Files, with Tags, Search, Only me and Company Settings in the account
 * menu; #106 brings Search and Only me back into the header and the Tags page is gone, so the menu keeps only Company
 * Settings and Log Out. Which of these a person actually sees is sections/headerNav.ts::signedInNavRoutes (Only me is for
 * user and above). The mobile bottom nav (BottomNav.tsx) keeps its own destinations. */
export const SIGNED_IN_NAV_ROUTES = ['calendar', 'search', 'company-files', 'only-me'] as const

/** Translated label per signed-in nav item, shared by the desktop header
 * (`Header.tsx`) and the mobile bottom nav (`BottomNav.tsx`, 2026-09-23
 * mobile-first header fix) so the two surfaces can't drift out of sync. */
export const NAV_LABEL_KEYS: Partial<Record<RouteId, string>> = {
  calendar: 'header.nav.calendar',
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
