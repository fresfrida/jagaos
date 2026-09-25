import logoMark from '../../assets/logo-mark-112.png'
import { PRODUCT_NAME } from '../../config/product'
import { Link } from '../../router/Link'
import { routeHref } from '../../router/routes'

/** The mark and the wordmark, in the header and the footer (DECISIONS #114). The mark is `assets/logo-mark-112.png`, a 28px logo at 4x
 * made from the supplied master by scripts/make_logo_assets.py, with transparent corners: it carries its own rounded shape, so no CSS
 * radius is put on it. It is decorative (`alt=""`): the link's `aria-label` and the wordmark beside it are its name. */
export function Logo() {
  return (
    <Link href={routeHref('home')} className="flex items-center gap-2.5" aria-label={`${PRODUCT_NAME} home`}>
      <img src={logoMark} alt="" width={28} height={28} className="h-7 w-7" />
      <span className="font-display text-[16px] font-semibold tracking-tight text-ink">{PRODUCT_NAME}</span>
    </Link>
  )
}
