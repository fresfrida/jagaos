import { PRODUCT_NAME } from '../config/product'

/** Real URL paths (/calendar), served by the SPA fallback on Vite, Caddy and Vercel (see web/vercel.json). */
export type RouteId = 'home' | 'calendar' | 'tags' | 'how-it-works' | 'stack' | 'get-started' | 'ops'
export type ResolvedRoute = RouteId | 'not-found'
/** Pages that share the title + content layout. */
export type FrameRouteId = 'calendar' | 'tags' | 'how-it-works' | 'stack' | 'ops'

export interface RouteConfig {
  path: string
  title: string
  description?: string
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
  ops: {
    path: '/ops',
    title: 'Ops console',
    description: 'Real backend test console — upload a document, see classify/extract/verify, gap analysis and obligations. Not part of the product UI.',
  },
}

/** The header tabs, in order. */
export const TAB_ROUTES = ['calendar', 'tags'] as const

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
