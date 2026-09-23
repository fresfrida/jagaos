import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Container } from '../components/ui/Container'
import { ROUTES, type FrameRouteId } from '../router/routes'

/** Shared shell for the frame pages: title, optional description, then the
 * content. `titleKey`/`descriptionKey` (2026-09-23) let a route opt into a
 * translated heading — used by the three new ops routes; the pre-existing
 * frame routes keep their plain, untranslated `title`/`description`. */
export function FramePage({ route, children }: { route: FrameRouteId; children: ReactNode }) {
  const { t } = useTranslation()
  const { title, description, titleKey, descriptionKey } = ROUTES[route]
  const resolvedTitle = titleKey ? t(titleKey) : title
  const resolvedDescription = descriptionKey ? t(descriptionKey) : description
  return (
    <Container className="py-8 sm:py-12">
      <div className="mb-8 max-w-2xl sm:mb-10">
        <h1 className="text-3xl font-semibold text-ink sm:text-4xl">{resolvedTitle}</h1>
        {resolvedDescription && <p className="mt-3 text-base leading-7 text-muted">{resolvedDescription}</p>}
      </div>
      {children}
    </Container>
  )
}
