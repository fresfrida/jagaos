import { PRODUCT_NAME } from '../../config/product'
import { Link } from '../../router/Link'
import { routeHref } from '../../router/routes'

/** The mark and the wordmark, in the header and the footer (DECISIONS #114). Round 5, item 1 (DECISIONS #125): the mark is now
 * adaptive, not hardcoded to one background — `variant="onDark"` (the header and footer, both ink bars since round 4, item 7)
 * draws the INVERTED mark (`assets/logo-thread-inverted.svg`: an off-white `#f5f7f5` tile, ink `#141414` thread, the same sage
 * inner stroke) with a white wordmark; `variant="onLight"` draws the ORIGINAL mark (`assets/logo-thread.svg`: an ink tile, white
 * thread, sage stroke) with an ink wordmark, for wherever this component next renders on an ordinary page background. In both,
 * the dot matches the thread's own colour (never sage — sage only ever appears in the inner stroke), so it reads as part of the
 * thread, not a third colour.
 *
 * Both marks are inlined (round 4, item 8c) rather than `<img src>`, so `#thread-dot` is a real, separately paintable DOM node —
 * a raster can't give you that. Both are cropped to JUST the icon tile (`viewBox 0 0 320 320`, each source's own `#app-icon`
 * group, un-translated), not the full 1080x1080 lockup, which also carries a background rect and a second, baked-in "JagaOS"
 * text label this component would otherwise duplicate. `#thread-dot` gets the same slow, subtle opacity pulse either way
 * (`.thread-dot-pulse`, index.css). Decorative (`aria-hidden`): the link's `aria-label` and the wordmark beside it are its name —
 * real ids from each source asset (`tile`, `thread-mark`, `thread-dot`) are kept for fidelity but never queried, since this
 * component can render more than once on one page (header + footer) and duplicate DOM ids are otherwise best avoided.
 *
 * FLAGGED, NOT GUESSED: the user asked for "a slightly more rounded corner" on the inverted tile in an earlier preview, but the
 * inverted SVG source they supplied carries the same `rx="68.5"` as the original — unchanged there, since the source files are
 * kept a truthful, unedited copy of what was supplied (same rule as `logo-mark.png`, the raster master). The bump lives only
 * here, in the ONE place it's actually drawn: `INVERTED_TILE_RADIUS = 76` (+11%, a deliberately small nudge, not a guess at
 * what "slightly" fully means) — say the exact number wanted and this one constant changes. */
const INVERTED_TILE_RADIUS = 76

export type LogoVariant = 'onLight' | 'onDark'

function ThreadDot({ fill }: { fill: string }) {
  return <circle id="thread-dot" className="thread-dot-pulse" cx={86} cy={87} r={8.5} fill={fill} stroke="none" />
}

function OriginalMark() {
  return (
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
        <ThreadDot fill="#ffffff" />
        <path
          d="M 33.5 34 L 33.5 62.5 A 26.25 26.25 0 0 0 86 62.5 L 86 22"
          stroke="#6ea99d"
          strokeWidth={15}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}

function InvertedMark() {
  return (
    <svg viewBox="0 0 320 320" aria-hidden="true" className="h-7 w-7">
      <rect id="tile" width="320" height="320" rx={INVERTED_TILE_RADIUS} fill="#f5f7f5" />
      <g id="thread-mark" transform="translate(74.3 71.4) scale(1.9048)" fill="none">
        <path
          d="M 8.5 82 L 8.5 35 A 26.5 26.5 0 0 1 61.5 35 L 61.5 62.5 A 24.5 24.5 0 0 0 86 87"
          stroke="#141414"
          strokeWidth={15}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <ThreadDot fill="#141414" />
        <path
          d="M 33.5 34 L 33.5 62.5 A 26.25 26.25 0 0 0 86 62.5 L 86 22"
          stroke="#6ea99d"
          strokeWidth={15}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  )
}

export function Logo({ variant }: { variant: LogoVariant }) {
  return (
    <Link href={routeHref('home')} className="flex items-center gap-2.5" aria-label={`${PRODUCT_NAME} home`}>
      {variant === 'onDark' ? <InvertedMark /> : <OriginalMark />}
      <span
        className={`font-display text-[16px] font-semibold tracking-tight ${variant === 'onDark' ? 'text-white' : 'text-ink'}`}
      >
        {PRODUCT_NAME}
      </span>
    </Link>
  )
}
