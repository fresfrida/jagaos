import { MotionConfig, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { AuthProvider, useAuth } from './features/auth/AuthContext'
import { MyCompaniesProvider } from './features/auth/MyCompaniesContext'
import { useCompanyScopeKey } from './features/auth/useCompanyScopeKey'
import { cn } from './lib/cn'
import { Page } from './pages/Page'
import type { ResolvedRoute } from './router/routes'
import { useRoute } from './router/useRoute'
import { useRouteEffects } from './router/useRouteEffects'
import { BottomNav } from './sections/BottomNav'
import { Footer } from './sections/Footer'
import { Header } from './sections/Header'

/** Split out of App() (2026-09-23, mobile-first header fix) so it can read
 * session status via useAuth() — a hook can only be called from a
 * descendant of AuthProvider, not from the component that renders
 * AuthProvider itself. */
function AppContent({ route }: { route: ResolvedRoute }) {
  const { t } = useTranslation()
  const { status, company } = useAuth()
  const companyScope = useCompanyScopeKey(company?.id)
  const showBottomNav = status === 'signed-in'

  return (
    <MotionConfig reducedMotion="user">
      <a
        href="#main"
        onClick={(event) => {
          // Move focus instead of following the #main hash, which would leave the current URL.
          event.preventDefault()
          document.getElementById('main')?.focus()
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-ink focus:px-4 focus:py-2 focus:text-white"
      >
        {t('app.skipToContent')}
      </a>
      <Header current={route} />
      {/* min-h keeps the footer below the fold while a page mounts, so it never jumps.
         The bottom padding (signed-in, phones only) keeps the fixed BottomNav
         below from covering the last item on the page — sm:pb-0 since the bar
         itself is sm:hidden. Round 14: 6.5rem (was 6rem) plus the same
         env(safe-area-inset-bottom) the bar adds to ITS height, so the two
         cannot drift apart. Measured beforehand, not assumed: at 375x812 the
         last of 19 review cards already cleared the raised Upload button by 47px,
         so this is margin for a larger system font or an inset, not a fix for a
         defect that reproduced. */}
      <main id="main" tabIndex={-1} className={cn('min-h-[calc(100svh-65px)] outline-none', showBottomNav && 'pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:pb-0')}>
        {/* Swap instantly and fade the new page in (opacity only). An exit animation would leave a gap and move the layout. */}
        {/* Keyed on the active company too (2026-09-24, round 12, DECISIONS
           #77): switching company remounts the page, so every hook refetches
           and no document, search result or form value from the previous
           company survives in component state. */}
        <motion.div key={`${route}:${companyScope}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
          <Page route={route} />
        </motion.div>
      </main>
      {/* 2026-09-23 (live regression report): the marketing footer
         (tagline, Product/Solutions/Resources/Company columns, social
         icons) was rendering on every signed-in app page too — confirmed
         live, and it has zero i18n wiring (config/site.ts's
         FOOTER_COLUMNS/FOOTER_TAGLINE), which is what actually surfaced
         it (untranslated footer text sitting under a fully-translated
         page). Real product decision, not just a translation gap: this
         footer's own content (marketing-page links like "Founders"/
         "Status") doesn't belong on a dashboard page — resolved as
         "remove from the signed-in app entirely," the same way the
         landing page (DECISIONS #64) already suppresses it, rather than
         translating marketing chrome that shouldn't be there. Gated on
         session status, not the route: was `route !== 'home'` (every
         non-landing route, including all six signed-in pages); now
         `status !== 'signed-in'` (every logged-out page, landing
         included, since a signed-in visitor never actually renders
         `home` — DECISIONS #64's HomeRedirect fires first). */}
      {status !== 'signed-in' && <Footer />}
      {showBottomNav && <BottomNav current={route} />}
    </MotionConfig>
  )
}

export default function App() {
  const route = useRoute()
  useRouteEffects(route)

  return (
    <AuthProvider>
      <MyCompaniesProvider>
        <AppContent route={route} />
      </MyCompaniesProvider>
    </AuthProvider>
  )
}
