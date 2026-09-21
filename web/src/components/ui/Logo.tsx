import { PRODUCT_NAME } from '../../config/product'

export function Logo() {
  return (
    <a href="#top" className="flex items-center gap-2.5" aria-label={`${PRODUCT_NAME} home`}>
      <span className="h-7 w-7 rounded-lg bg-ink" aria-hidden="true" />
      <span className="font-display text-[15px] font-semibold tracking-tight text-ink">{PRODUCT_NAME}</span>
    </a>
  )
}
