import { MotionConfig } from 'framer-motion'
import { ProductPreview } from './features/preview/ProductPreview'
import { usePreviewNavigation } from './features/preview/usePreviewNavigation'
import { FinalCTA } from './sections/FinalCTA'
import { Footer } from './sections/Footer'
import { Header } from './sections/Header'
import { Hero } from './sections/Hero'
import { HowItWorks } from './sections/HowItWorks'
import { StackList } from './sections/StackList'

export default function App() {
  const { mode, activationKey, open, switchTab } = usePreviewNavigation()

  return (
    <MotionConfig reducedMotion="user">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <Header onOpenPreview={open} />
      <main id="main">
        <Hero onOpenPreview={open} />
        <ProductPreview mode={mode} onModeChange={switchTab} activationKey={activationKey} />
        <HowItWorks />
        <StackList />
        <FinalCTA onOpenPreview={open} />
      </main>
      <Footer />
    </MotionConfig>
  )
}
