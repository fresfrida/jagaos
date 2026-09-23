import { MotionConfig, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { AuthProvider, useAuth } from './features/auth/AuthContext'
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
  const { status } = useAuth()
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
         pb-24 (signed-in, phones only) keeps the fixed BottomNav below from
         covering the last item on the page — sm:pb-0 since the bar itself
         is sm:hidden. */}
      <main id="main" tabIndex={-1} className={cn('min-h-[calc(100svh-65px)] outline-none', showBottomNav && 'pb-24 sm:pb-0')}>
        {/* Swap instantly and fade the new page in (opacity only). An exit animation would leave a gap and move the layout. */}
        <motion.div key={route} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
          <Page route={route} />
        </motion.div>
      </main>
      {/* The landing page is hero-only: no footer, no scroll. */}
      {route !== 'home' && <Footer />}
      {showBottomNav && <BottomNav current={route} />}
    </MotionConfig>
  )
}

export default function App() {
  const route = useRoute()
  useRouteEffects(route)

  return (
    <AuthProvider>
      <AppContent route={route} />
    </AuthProvider>
  )
}
