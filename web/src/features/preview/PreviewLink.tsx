import { CalendarDays, Tag } from 'lucide-react'
import type { MouseEvent } from 'react'
import { ButtonLink } from '../../components/ui/ButtonLink'
import type { ButtonSize, ButtonVariant } from '../../components/ui/Button'
import { PREVIEW_LINKS } from '../../config/site'
import type { PreviewMode } from './types'

interface PreviewLinkProps {
  mode: PreviewMode
  onOpen: (mode: PreviewMode) => void
  variant?: ButtonVariant
  size?: ButtonSize
  /** Override the default label from config (e.g. "Get Started" in the header). */
  label?: string
  showIcon?: boolean
}

/** A link to one of the preview frames. Modified clicks (new tab, etc.) keep native behaviour. */
export function PreviewLink({ mode, onOpen, variant, size, label, showIcon = true }: PreviewLinkProps) {
  const link = PREVIEW_LINKS[mode]
  const Icon = mode === 'calendar' ? CalendarDays : Tag

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    onOpen(mode)
  }

  return (
    <ButtonLink href={link.href} variant={variant} size={size} onClick={onClick} icon={showIcon ? <Icon size={16} aria-hidden="true" /> : undefined}>
      {label ?? link.label}
    </ButtonLink>
  )
}
