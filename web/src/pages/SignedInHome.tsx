/** The signed-in `/` (2026-09-25, round 20, item 2 of the UI round): a small hub, not a page with
 * things embedded in it. It used to redirect straight into the Calendar (Page.tsx's HomeRedirect,
 * DECISIONS #64, added so a signed-in visitor no longer saw the marketing hero); now it is a real
 * page the logo returns to.
 *
 * Two entries, in this order of weight, in black, white and tints of black only (the peer's ruling:
 * no green on this page; hierarchy is tone, not a new colour). UPLOAD is the dominant one: a large card
 * in the same near-black as the header's Upload button, linking to /upload, with the number of items
 * waiting for review as a white pill on the card itself (that is where the review list is). ONLY ME is a
 * quieter row under it, a light tint of black with dark text, linking to /only-me. Neither is embedded:
 * no upload rows here, no private files here.
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
    <Container className="py-8 sm:py-12">
      <h1 className="sr-only">{t('home.signedIn.pageTitle')}</h1>
      {/* About 720px, centred: a full-width slab on a desktop reads as a wall, not a button. */}
      <div className="mx-auto max-w-[720px]">
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
          className="mt-4 flex items-center gap-3 rounded-card bg-ink/5 px-4 py-3.5 transition-colors hover:bg-ink/10"
        >
          <Lock size={18} className="shrink-0 text-ink" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium text-ink">{t('header.nav.onlyMe')}</span>
            <span className="block text-[14px] leading-5 text-muted">{t('home.signedIn.onlyMe.hint')}</span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden="true" />
        </Link>
      </div>
    </Container>
  )
}
