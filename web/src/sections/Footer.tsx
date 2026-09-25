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
 * carried four columns of placeholder links and social icons). Left: the JagaOS mark, one line about the product and the
 * copyright in the legal entity's name (not the product's). Right, signed out only: Get Started, which opens the same demo
 * picker as the header's and the landing page's buttons. Bottom row: three links, PLACEHOLDERS (`#`) until the real URLs
 * exist (config/site.ts).
 *
 * Signed in on a phone, the fixed bottom bar sits over the last ~60px of the page, and its raised Upload button rises above
 * that. The footer is the last thing on the page, so it takes the bar's clearance itself (PHONE_BOTTOM_NAV_CLEARANCE, the
 * constant that used to pad `main`): without it the links row would sit behind the bar. */
export function Footer() {
  const { t } = useTranslation()
  const { status } = useAuth()
  const signedIn = status === 'signed-in'

  return (
    <footer className={cn('border-t border-line py-8 sm:py-10', signedIn && PHONE_BOTTOM_NAV_CLEARANCE)}>
      <Container>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Logo />
            <p className="mt-3 max-w-[26rem] text-sm leading-6 text-muted">{t('footer.tagline')}</p>
            <p className="mt-2 text-[14px] text-muted">{t('footer.copyright', { year: COPYRIGHT_YEAR, entity: LEGAL_ENTITY })}</p>
          </div>
          {!signedIn && (
            <Button variant="secondary" size="sm" className="self-start whitespace-nowrap" onClick={openDemoPicker} aria-haspopup="dialog">
              {t('header.getStarted')}
            </Button>
          )}
        </div>
        <nav aria-label={t('footer.linksLabel')} className="mt-6 border-t border-line pt-5">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[14px]">
            {FOOTER_LINKS.map(({ id, href }) => (
              <li key={id}>
                {/* A `#` placeholder must not jump the page to the top or leave a `#` entry in the history. */}
                <a
                  href={href}
                  onClick={href === '#' ? (event) => event.preventDefault() : undefined}
                  className="text-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
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
