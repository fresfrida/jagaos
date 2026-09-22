import { Compass } from 'lucide-react'
import { ButtonLink } from '../components/ui/ButtonLink'
import { Container } from '../components/ui/Container'
import { EmptyState } from '../components/ui/EmptyState'
import { routeHref } from '../router/routes'

export function NotFoundPage() {
  return (
    <Container className="flex min-h-[calc(100svh-65px)] flex-col items-center justify-center py-16">
      <EmptyState icon={<Compass size={24} />} title="Page not found" description="That link does not match a page." />
      <ButtonLink href={routeHref('home')} variant="secondary" className="mt-2">
        Back to home
      </ButtonLink>
    </Container>
  )
}
