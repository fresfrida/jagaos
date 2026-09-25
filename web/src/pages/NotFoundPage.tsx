import { Compass } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ButtonLink } from '../components/ui/ButtonLink'
import { Container } from '../components/ui/Container'
import { EmptyState } from '../components/ui/EmptyState'
import { routeHref } from '../router/routes'

// 2026-09-23, live BM/Tamil i18n audit: found by grep, not on the seed
// list — a real page (reachable signed-in and signed-out) with zero i18n
// wiring.
export function NotFoundPage() {
  const { t } = useTranslation()
  return (
    <Container className="flex min-h-[calc(100svh-65px)] flex-col items-center justify-center py-16">
      <EmptyState icon={<Compass size={24} />} title={t('app.notFound.title')} description={t('app.notFound.description')} />
      <ButtonLink href={routeHref('home')} variant="secondary" className="mt-2">
        {t('app.notFound.backToHome')}
      </ButtonLink>
    </Container>
  )
}
