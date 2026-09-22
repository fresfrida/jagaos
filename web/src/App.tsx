import { MotionConfig, motion } from 'framer-motion'
import { AuthProvider } from './features/auth/AuthContext'
import { Page } from './pages/Page'
import { useRoute } from './router/useRoute'
import { useRouteEffects } from './router/useRouteEffects'
import { Footer } from './sections/Footer'
import { Header } from './sections/Header'

export default function App() {
  const route = useRoute()
  useRouteEffects(route)

  return (
    <AuthProvider>
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
          Skip to content
        </a>
        <Header current={route} />
        {/* min-h keeps the footer below the fold while a page mounts, so it never jumps. */}
        <main id="main" tabIndex={-1} className="min-h-[calc(100svh-65px)] outline-none">
          {/* Swap instantly and fade the new page in (opacity only). An exit animation would leave a gap and move the layout. */}
          <motion.div key={route} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
            <Page route={route} />
          </motion.div>
        </main>
        {/* The landing page is hero-only: no footer, no scroll. */}
        {route !== 'home' && <Footer />}
      </MotionConfig>
    </AuthProvider>
  )
}
