import { RouteCta } from '../components/RouteCta'
import { Container } from '../components/ui/Container'
import { FINAL_CTA } from '../config/site'

export function GetStartedPage() {
  return (
    <Container className="flex min-h-[calc(100svh-65px)] items-center py-16">
      <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
        <h1 className="text-3xl font-semibold leading-tight text-ink sm:text-5xl">{FINAL_CTA.heading}</h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">{FINAL_CTA.copy}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <RouteCta route="calendar" />
          <RouteCta route="tags" variant="secondary" />
        </div>
      </div>
    </Container>
  )
}
