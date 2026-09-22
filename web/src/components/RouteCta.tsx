import { CalendarDays, Tag } from 'lucide-react'
import { CTA_LABELS } from '../config/site'
import { routeHref } from '../router/routes'
import type { ButtonVariant } from './ui/Button'
import { ButtonLink } from './ui/ButtonLink'

const ICONS = { calendar: CalendarDays, tags: Tag } as const

/** A button-styled link to the Calendar or Tags page. Used by the hero and the Get Started page. */
export function RouteCta({ route, variant }: { route: keyof typeof ICONS; variant?: ButtonVariant }) {
  const Icon = ICONS[route]
  return (
    <ButtonLink href={routeHref(route)} variant={variant} icon={<Icon size={16} aria-hidden="true" />}>
      {CTA_LABELS[route]}
    </ButtonLink>
  )
}
