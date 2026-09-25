import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { Container } from '../components/ui/Container'
import { Logo } from '../components/ui/Logo'
import { COPYRIGHT_YEAR, FOOTER_LINKS, LEGAL_ENTITY } from '../config/site'
import { useAuth } from '../features/auth/AuthContext'
import { cn } from '../lib/cn'
import { openDemoPicker } from '../lib/demoPickerTrigger'
import { PHONE_BOTTOM_NAV_CLEARANCE } from './BottomNav'

/** The site footer, on EVERY page, signed in or out (DECISIONS #106; until then it was signed-out only, and before round 16 it
 * carried four columns of placeholder links and social icons). The mark, one line about the product and the copyright in the
 * legal entity's name (not the product's); signed out, Get Started, which opens the same demo picker as the header's and the
 * landing page's button; then three links, PLACEHOLDERS (`#`) until the real URLs exist (config/site.ts).
 *
 * Layout (DECISIONS #108): on a PHONE everything is centred in one column, in this order: the mark, the tagline, the copyright,
 * Get Started (signed out) on its own row, then the three links, one per row, each a 44px-tall tap target. From `sm` up it is
 * the layout it already was: the brand block on the left, Get Started on the right, the links in a row underneath.
 *
 * `visible` (DECISIONS #108): the footer is laid out at all times but only SEEN once the page above it has finished loading
 * (hooks/usePageSettled.ts), so it never appears under half a page and jumps down as the data arrives. That is what allowed
 * `<main>` to lose its near-viewport minimum height: a short, loaded page now has its footer directly under its content.
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
          {!signedIn && (
            <Button variant="secondary" size="sm" className="whitespace-nowrap sm:self-start" onClick={openDemoPicker} aria-haspopup="dialog">
              {t('header.getStarted')}
            </Button>
          )}
        </div>
        <nav aria-label={t('footer.linksLabel')} className="mt-6 border-t border-line pt-3 sm:pt-5">
          <ul className="flex flex-col items-center sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
            {FOOTER_LINKS.map(({ id, href }) => (
              <li key={id}>
                {/* A `#` placeholder must not jump the page to the top or leave a `#` in the history. */}
                <a
                  href={href}
                  onClick={href === '#' ? (event) => event.preventDefault() : undefined}
                  className="inline-flex min-h-[44px] items-center text-[14px] text-muted underline-offset-4 transition-colors hover:text-ink hover:underline sm:min-h-0"
                >
                  {t(`footer.links.${id}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </Container>
    </footer>
  )
}
