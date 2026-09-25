import { useTranslation } from 'react-i18next'
import { Container } from '../components/ui/Container'
import { Logo } from '../components/ui/Logo'
import { COPYRIGHT_YEAR, FOOTER_LINKS, LEGAL_ENTITY } from '../config/site'
import { useAuth } from '../features/auth/AuthContext'
import { cn } from '../lib/cn'
import { PHONE_BOTTOM_NAV_CLEARANCE } from './BottomNav'

/** The site footer, on EVERY page, signed in or out (DECISIONS #106; until then it was signed-out only, and before round 16 it
 * carried four columns of placeholder links and social icons). The mark, one line about the product and the copyright in the
 * legal entity's name (not the product's), and three links, PLACEHOLDERS (`#`) until the real URLs exist (config/site.ts).
 * It has no call-to-action button (DECISIONS #111): the header's Get Started and the landing page's own button are the two.
 *
 * Layout (DECISIONS #108, #111): on a PHONE everything is centred in one column, in this order: the mark, the tagline, the
 * copyright, then the three links, one per row, each a 44px-tall tap target. From `sm` up it is two blocks: the brand block on
 * the left and the three links, stacked, on the right (the slot Get Started used to fill). Each link is rendered once.
 *
 * `visible` (DECISIONS #108, #112): the footer is laid out at all times but only SEEN once the FIRST page above it has finished
 * loading (hooks/usePageSettled.ts), so it never appears under half a page and jumps down as the data arrives; App.tsx latches it
 * from then on, so it does not vanish and fade back in on every navigation. That is what allowed `<main>` to lose its
 * near-viewport minimum height: a short, loaded page now has its footer directly under its content.
 *
 * Signed in on a phone, the fixed bottom bar sits over the last ~60px of the page, and its raised Upload button rises above
 * that. The footer is the last thing on the page, so it takes the bar's clearance itself (PHONE_BOTTOM_NAV_CLEARANCE): without
 * it the links row would sit behind the bar. */
export function Footer({ visible = true }: { visible?: boolean }) {
  const { t } = useTranslation()
  const { status } = useAuth()
  const signedIn = status === 'signed-in'

  return (
    <footer
      className={cn(
        'border-t border-line py-8 transition-opacity duration-300 motion-reduce:transition-none sm:py-10',
        signedIn && PHONE_BOTTOM_NAV_CLEARANCE,
        !visible && 'invisible opacity-0',
      )}
    >
      <Container>
        <div className="flex flex-col items-center gap-5 text-center sm:flex-row sm:items-start sm:justify-between sm:text-left">
          <div className="flex flex-col items-center sm:items-start">
            <Logo />
            <p className="mt-3 max-w-[26rem] text-sm leading-6 text-muted">{t('footer.tagline')}</p>
            <p className="mt-2 text-[14px] text-muted">{t('footer.copyright', { year: COPYRIGHT_YEAR, entity: LEGAL_ENTITY })}</p>
          </div>
          <nav aria-label={t('footer.linksLabel')}>
            <ul className="flex flex-col items-center sm:items-end sm:gap-2">
              {FOOTER_LINKS.map(({ id, href }) => (
                <li key={id}>
                  {/* A `#` placeholder must not jump the page to the top or leave a `#` in the history. A step larger and
                     heavier than the muted body text (DECISIONS #111): they read as hard to see at 14px regular. Same colour. */}
                  <a
                    href={href}
                    // New tab for all three (DECISIONS #118): the video is another site and the PDFs are documents; the landing page stays put.
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={href === '#' ? (event) => event.preventDefault() : undefined}
                    className="inline-flex min-h-[44px] items-center text-[15px] font-medium text-muted underline-offset-4 transition-colors hover:text-ink hover:underline sm:min-h-0"
                  >
                    {t(`footer.links.${id}`)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </Container>
    </footer>
  )
}
