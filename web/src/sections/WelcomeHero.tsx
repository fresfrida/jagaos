/** Signed-out landing (round 16, item 2; the round 9 version was a centred
 * heading and two buttons that both went to /login). Designed for a phone first
 * and only stretched for a desktop: one pitch line that names the pain, one warm
 * button that opens the demo company, and three small cards saying what the
 * product does. Compact, not a full-screen hero: the page starts under the header
 * and the cards are on screen at 375px without scrolling past a wall of text.
 *
 * The button signs in as the seeded demo owner through the ordinary login flow
 * (features/auth/useDemoLogin.ts, config/demo.ts): no bypass. "Sign in" stays as a
 * quiet link for someone with a real account. A signed-in visitor never renders
 * this: Page.tsx redirects `home` into the Calendar. */

import { CalendarClock, ClipboardCheck, ScanLine } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { ButtonLink } from '../components/ui/ButtonLink'
import { Card } from '../components/ui/Card'
import { Container } from '../components/ui/Container'
import { DemoPicker } from '../features/auth/DemoPicker'
import { routeHref } from '../router/routes'

const FEATURES = [
  { id: 'capture', icon: ScanLine },
  { id: 'review', icon: ClipboardCheck },
  { id: 'obligations', icon: CalendarClock },
] as const

export function WelcomeHero() {
  const { t } = useTranslation()
  const [pickerOpen, setPickerOpen] = useState(false)

  return (
    <section className="py-8 sm:py-14">
      <Container>
        <div className="mx-auto max-w-3xl">
          <h1 className="max-w-xl text-[28px] font-semibold leading-[1.15] text-ink sm:text-4xl">{t('home.pitch')}</h1>

          <div className="mt-6">
            <Button size="md" className="w-full sm:w-auto" onClick={() => setPickerOpen(true)} aria-haspopup="dialog">
              {t('home.demo.button')}
            </Button>
            <p className="mt-2 text-[14px] text-muted">{t('home.demo.hint')}</p>
            <ButtonLink href={routeHref('login')} variant="secondary" size="md" className="mt-5 w-full sm:w-auto">
              {t('home.signIn')}
            </ButtonLink>
            <p className="mt-2 text-[14px] text-muted">{t('home.signInHint')}</p>
          </div>

          <ul className="mt-8 grid gap-3 sm:grid-cols-3">
            {FEATURES.map(({ id, icon: Icon }) => (
              <li key={id}>
                <Card className="h-full p-4" interactive={false}>
                  <Icon size={20} strokeWidth={1.75} className="text-sage-ink" aria-hidden="true" />
                  <h2 className="mt-3 text-[16px] font-semibold text-ink">{t(`home.features.${id}.title`)}</h2>
                  <p className="mt-1 text-[14px] leading-5 text-muted">{t(`home.features.${id}.text`)}</p>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </Container>
      <DemoPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </section>
  )
}
