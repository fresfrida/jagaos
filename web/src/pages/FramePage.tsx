import type { ReactNode } from 'react'
import { Container } from '../components/ui/Container'
import { ROUTES, type FrameRouteId } from '../router/routes'

/** Shared shell for the frame pages: title, optional description, then the content. */
export function FramePage({ route, children }: { route: FrameRouteId; children: ReactNode }) {
  const { title, description } = ROUTES[route]
  return (
    <Container className="py-8 sm:py-12">
      <div className="mb-8 max-w-2xl sm:mb-10">
        <h1 className="text-3xl font-semibold text-ink sm:text-4xl">{title}</h1>
        {description && <p className="mt-3 text-base leading-7 text-muted">{description}</p>}
      </div>
      {children}
    </Container>
  )
}
