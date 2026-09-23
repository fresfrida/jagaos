/** Signed-out landing content (2026-09-23, role/permission work) —
 * deliberately minimal: heading, one supporting line, two buttons, no
 * scroll, no marketing chrome below the fold. Both buttons go to /login,
 * not GetStartedPage — per the explicit ask, this is a doorway into the
 * app, not a second marketing surface. Replaces the previous unconditional
 * <Hero/> (deleted — see docs/DECISIONS.md): Page.tsx's `home` case never
 * branched on session status the way `calendar`/`tags` already did, so a
 * signed-in visitor to / saw this same marketing hero instead of the app,
 * a confirmed gap this task closes.
 *
 * Footer suppression: App.tsx already hides the Footer for `route ===
 * 'home'` (a pre-existing check, unchanged) — this component doesn't
 * need its own "no footer" logic, it inherits it from the route. */

import { useTranslation } from 'react-i18next'
import { ButtonLink } from '../components/ui/ButtonLink'
import { Container } from '../components/ui/Container'
import { routeHref } from '../router/routes'

export function WelcomeHero() {
  const { t } = useTranslation()
  return (
    <section className="flex min-h-[calc(100svh-65px)] items-center justify-center py-10">
      <Container className="w-full">
        <div className="mx-auto flex max-w-lg flex-col items-center text-center">
          <h1 className="text-4xl font-semibold leading-tight text-ink sm:text-5xl">{t('home.heading')}</h1>
          <p className="mt-4 text-base leading-7 text-muted sm:text-lg">{t('home.subheading')}</p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <ButtonLink href={routeHref('login')}>{t('home.signIn')}</ButtonLink>
            <ButtonLink href={routeHref('login')} variant="secondary">{t('home.getStarted')}</ButtonLink>
          </div>
        </div>
      </Container>
    </section>
  )
}
