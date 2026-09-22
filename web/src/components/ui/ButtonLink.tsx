import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { Link } from '../../router/Link'
import { buttonClasses, type ButtonSize, type ButtonVariant } from './Button'

interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
}

/** A real link (client-side routed for "/..." hrefs) that looks like a Button. Use <Button> for actions. */
export function ButtonLink({ variant, size, icon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  )
}
