import { motion } from 'framer-motion'
import { Container } from '../components/ui/Container'
import { HERO } from '../config/site'
import { MemorySearch } from '../features/search/MemorySearch'
import { PreviewLink } from '../features/preview/PreviewLink'
import type { PreviewMode } from '../features/preview/types'

/** The first screen. Exactly one viewport tall (minus the 65px sticky header: 64px + 1px border) so nothing below bleeds into it. */
export function Hero({ onOpenPreview }: { onOpenPreview: (mode: PreviewMode) => void }) {
  return (
    <section id="top" className="flex min-h-[calc(100svh-65px)] items-center py-10">
      <Container className="w-full">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="mx-auto flex max-w-5xl flex-col items-center text-center"
        >
          <p className="rounded-full bg-canvas px-3 py-1 text-xs font-medium text-ink ring-1 ring-line">{HERO.pill}</p>

          <h1 className="mt-6 text-[2.5rem] font-semibold leading-[1.05] text-ink sm:text-5xl lg:text-[64px] xl:text-[72px]">
            {HERO.headingLead} <span className="whitespace-nowrap text-charcoal/70">{HERO.headingSoft}</span>
          </h1>

          <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">{HERO.copy}</p>

          <div className="mt-8 w-full">
            <MemorySearch />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <PreviewLink mode="calendar" onOpen={onOpenPreview} />
            <PreviewLink mode="tags" onOpen={onOpenPreview} variant="secondary" />
          </div>
        </motion.div>
      </Container>
    </section>
  )
}
