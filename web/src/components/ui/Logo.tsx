import { PRODUCT_NAME } from '../../config/product'
import { Link } from '../../router/Link'
import { routeHref } from '../../router/routes'

export function Logo() {
  return (
    <Link href={routeHref('home')} className="flex items-center gap-2.5" aria-label={`${PRODUCT_NAME} home`}>
      <span className="h-7 w-7 rounded-lg bg-ink" aria-hidden="true" />
      <span className="font-display text-[16px] font-semibold tracking-tight text-ink">{PRODUCT_NAME}</span>
    </Link>
  )
}
