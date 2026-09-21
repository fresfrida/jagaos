import { Container } from '../components/ui/Container'
import { Reveal } from '../components/ui/Reveal'
import { FINAL_CTA } from '../config/site'
import { PreviewLink } from '../features/preview/PreviewLink'
import type { PreviewMode } from '../features/preview/types'

export function FinalCTA({ onOpenPreview }: { onOpenPreview: (mode: PreviewMode) => void }) {
  return (
    <section id="get-started" aria-labelledby="cta-heading" className="border-t border-line bg-canvas py-20 sm:py-28">
      <Container>
        <Reveal className="mx-auto flex max-w-2xl flex-col items-center text-center">
          <h2 id="cta-heading" className="text-3xl font-semibold leading-tight text-ink sm:text-5xl">
            {FINAL_CTA.heading}
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">{FINAL_CTA.copy}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <PreviewLink mode="calendar" onOpen={onOpenPreview} />
            <PreviewLink mode="tags" onOpen={onOpenPreview} variant="secondary" />
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
