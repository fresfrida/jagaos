import { PRODUCT_NAME } from '../../config/product'
import { Link } from '../../router/Link'
import { routeHref } from '../../router/routes'

/** The mark and the wordmark, in the header and the footer (DECISIONS #114) — both dark bars since round 4, item 7 (DECISIONS #122),
 * so the wordmark is white; if this component ever renders on a light background again, that needs a prop, not a hardcoded flip
 * back.
 *
 * The mark is inlined from `assets/logo-thread.svg` (round 4, item 8c, DECISIONS #122), a real vector the user supplied to replace
 * the flat raster (`logo-mark-112.png`, now unused here) once its sage dot needed to be its own animatable element, which a raster
 * image cannot give you. Inlined rather than `<img src>` for exactly that reason: only inline SVG puts `#thread-dot` in the DOM as
 * a real, separately paintable node. Cropped to JUST the icon tile (`viewBox 0 0 320 320`, the source's own `#app-icon` group,
 * un-translated) — not the full 1080x1080 canvas, which also carries a white background rect and a second, baked-in "JagaOS" text
 * label: this component already renders its own wordmark beside the mark, so the full lockup would have doubled it and covered
 * this dark header/footer in a white square. The tile (`#141414`, the app's own ink) now reads as flush with the dark bar behind
 * it rather than a visible square, which is a side effect of item 7's inversion, not a bug: only the white+sage thread shape floats
 * on the bar now. `#thread-dot` gets a slow, subtle opacity pulse (`.thread-dot-pulse`, index.css), nothing else in the mark. It is
 * decorative (`aria-hidden`): the link's `aria-label` and the wordmark beside it are its name — real ids from the source asset
 * (`tile`, `thread-mark`, `thread-dot`) are kept for fidelity but never queried, since this component renders twice on one page
 * (header + footer) and duplicate DOM ids are otherwise best avoided. */
export function Logo() {
  return (
    <Link href={routeHref('home')} className="flex items-center gap-2.5" aria-label={`${PRODUCT_NAME} home`}>
      <svg viewBox="0 0 320 320" aria-hidden="true" className="h-7 w-7">
        <rect id="tile" width="320" height="320" rx="68.5" fill="#141414" />
        <g id="thread-mark" transform="translate(74.3 71.4) scale(1.9048)" fill="none">
          <path
            d="M 8.5 82 L 8.5 35 A 26.5 26.5 0 0 1 61.5 35 L 61.5 62.5 A 24.5 24.5 0 0 0 86 87"
            stroke="#ffffff"
            strokeWidth={15}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle id="thread-dot" className="thread-dot-pulse" cx={86} cy={87} r={8.5} fill="#ffffff" stroke="none" />
          <path
            d="M 33.5 34 L 33.5 62.5 A 26.25 26.25 0 0 0 86 62.5 L 86 22"
            stroke="#6ea99d"
            strokeWidth={15}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </svg>
      <span className="font-display text-[16px] font-semibold tracking-tight text-white">{PRODUCT_NAME}</span>
    </Link>
  )
}
