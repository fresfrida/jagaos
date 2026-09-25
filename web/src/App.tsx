import { MotionConfig, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { AuthProvider, useAuth } from './features/auth/AuthContext'
import { DemoPickerHost } from './features/auth/DemoPickerHost'
import { MyCompaniesProvider } from './features/auth/MyCompaniesContext'
import { UploadSheetHost } from './features/upload/UploadSheetHost'
import { useCompanyScopeKey } from './features/auth/useCompanyScopeKey'
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
      {/* min-h keeps the footer below the fold while a page mounts, so it never jumps. The signed-in phone's bottom padding for the
         fixed BottomNav is on the footer, which is what ends the page (sections/Footer.tsx); it used to be on this element, back
         when signed-in pages had no footer. */}
      <main id="main" tabIndex={-1} className="min-h-[calc(100svh-65px)] outline-none">
        {/* Swap instantly and fade the new page in (opacity only). An exit animation would leave a gap and move the layout. */}
        {/* Keyed on the active company too (2026-09-24, round 12, DECISIONS
           #77): switching company remounts the page, so every hook refetches
           and no document, search result or form value from the previous
           company survives in component state. */}
        <motion.div key={`${route}:${companyScope}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
          <Page route={route} />
        </motion.div>
      </main>
      {/* On every page, signed in or out (DECISIONS #106). It was signed-out only from 2026-09-23, when it was a marketing footer
         of untranslated links; it is now three short lines and a link row, translated, so it belongs everywhere. */}
      <Footer />
      {/* The one demo picker, opened by every Get Started / Pick a demo role button; only while nobody is signed in. */}
      {status !== 'signed-in' && <DemoPickerHost />}
      {showBottomNav && <BottomNav current={route} />}
      <UploadSheetHost />
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
