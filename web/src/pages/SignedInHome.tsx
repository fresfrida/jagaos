/** The signed-in `/` (2026-09-25, round 20, item 2 of the UI round): a small hub, not a page with
 * things embedded in it. It used to redirect straight into the Calendar (Page.tsx's HomeRedirect,
 * DECISIONS #64, added so a signed-in visitor no longer saw the marketing hero); now it is a real
 * page the logo returns to.
 *
 * Two entries, in this order of weight, in black, white and tints of black only (the peer's ruling:
 * no green on this page; hierarchy is tone, not a new colour). UPLOAD is the dominant one: a large card
 * in the same near-black as the header's Upload button, linking to /upload, with the number of items
 * waiting for review as a white pill on the card itself (that is where the review list is). ONLY ME is a
 * quieter card next to or under it, a light tint of black with dark text, linking to /only-me. Neither is embedded:
 * no upload rows here, no private files here.
 *
 * The two cards are the SAME SHAPE at every width (DECISIONS #118, which reverses #108): the icon on its own line, then the
 * title, then the description, with the chevron at the top right, the same padding and the same type scale as Upload. The grid's
 * rows are `auto-rows-fr`, and in a grid whose height is not fixed the `fr` rows are sized from the content, so both cards are
 * as tall as the taller one (Upload with its review-count pill, or without it), in any language. #108 had made Only me a
 * shorter horizontal row on a phone, exactly two thirds of Upload's height (`3fr 2fr`); that is gone.
 *
 * From `lg` (DECISIONS #106) the two sit SIDE BY SIDE in a column about 960px wide, and Only me is an outlined card (a real border
 * on white) instead of the tinted one. One element per entry, restyled with `lg:` colours only, so the two layouts cannot drift
 * apart in content or in shape.
 *
 * Privacy: a private (Only me) file never surfaces outside the Only me section, so the waiting count
 * leaves out the person's own private files (useWaitingReviews).
 *
 * Who sees it: owner, admin and user. A viewer cannot upload, so there is no hub for them: Page.tsx
 * renders the Only me page at `/` for a viewer instead (decided in the round's final ruling).
 * The bottom nav is unchanged. */

import { ChevronRight, Lock, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Container } from '../components/ui/Container'
import { useAuth } from '../features/auth/AuthContext'
import { useWaitingReviews } from '../features/ops/useWaitingReviews'
import { Link } from '../router/Link'
import { routeHref } from '../router/routes'

export function SignedInHome() {
  const { t } = useTranslation()
  const { role } = useAuth()
  const waiting = useWaitingReviews(role)

  // "Your review" only where the person can resolve the item; a `user` whose own company upload waits
  // for an admin sees a plainer line (useWaitingReviews explains the two counts).
  const waitingCount = waiting.mine > 0 ? waiting.mine : waiting.total
  const waitingKey = waiting.mine > 0 ? 'home.signedIn.review.mine' : 'home.signedIn.review.pending'

  return (
    // From `lg` the App shell makes this page fill the viewport (router/routes.ts FIT_VIEWPORT_ROUTES, DECISIONS #109), and this container
    // grows into that space and centres the cards in it, vertically as well as across.
    <Container className="py-8 sm:py-12 lg:flex lg:flex-1 lg:items-center">
      <h1 className="sr-only">{t('home.signedIn.pageTitle')}</h1>
      {/* About 720px on a phone and a tablet, centred: a full-width slab reads as a wall, not a button. A grid with equal rows
         (`auto-rows-fr`): below `lg` one column, two equal rows; from `lg` one row of two columns. Either way the two cards are the
         same height (DECISIONS #118). */}
      <div className="mx-auto grid max-w-[720px] auto-rows-fr gap-4 lg:w-full lg:max-w-[960px] lg:grid-cols-2">
        <Link
          href={routeHref('upload')}
          data-testid="home-upload"
          className="group block rounded-card bg-ink p-6 text-white transition-colors hover:bg-black sm:p-8"
        >
          <span className="flex items-start justify-between gap-4">
            <span className="min-w-0">
              <Upload size={32} strokeWidth={1.75} aria-hidden="true" />
              <span className="mt-4 block text-2xl font-semibold sm:text-3xl">{t('home.signedIn.upload.title')}</span>
              <span className="mt-1.5 block text-[16px] leading-6 text-white/90">{t('home.signedIn.upload.hint')}</span>
            </span>
            <ChevronRight size={24} className="mt-1 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
          {waiting.total > 0 && (
            <span
              data-testid="home-review-count"
              className="mt-5 inline-block rounded-full bg-white px-3 py-1 text-[14px] font-medium text-ink"
            >
              {t(waitingKey, { count: waitingCount })}
            </span>
          )}
        </Link>

        <Link
          href={routeHref('only-me')}
          data-testid="home-only-me"
          className="group block rounded-card bg-ink/5 p-6 transition-colors hover:bg-ink/10 sm:p-8 lg:border lg:border-line lg:bg-white lg:hover:border-ink/40 lg:hover:bg-white"
        >
          {/* Upload's own arrangement (DECISIONS #118): the icon, then the title, then the description, and the chevron at the top right. */}
          <span className="flex items-start justify-between gap-4">
            <span className="min-w-0">
              <Lock className="h-8 w-8 text-ink" size={24} aria-hidden="true" />
              <span className="mt-4 block text-2xl font-semibold text-ink sm:text-3xl">{t('header.nav.onlyMe')}</span>
              <span className="mt-1.5 block text-[16px] leading-6 text-muted">{t('home.signedIn.onlyMe.hint')}</span>
            </span>
            <ChevronRight size={24} className="mt-1 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </span>
        </Link>
      </div>
    </Container>
  )
}
