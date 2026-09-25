/** Signed-out landing (round 16, item 2; the round 9 version was a centred heading and two buttons that both went to
 * /login; reworked in round 21, Part B, DECISIONS #101 into a quiet commercial page; the "How it works" strip was removed in
 * DECISIONS #106).
 *
 * Register: Apple's. Short sentences, no exclamation marks, no superlatives; the product steps back and the owner's life
 * steps forward. The page, top to bottom: a headline and one supporting sentence with the one call to action (a demo, through
 * the ordinary login: features/auth/useDemoLogin.ts, config/demo.ts, no bypass), a real screenshot of the app in a plain phone
 * frame, three cards (Capture, Review, Remember), and a closing line above the same call to action again. Both buttons open
 * the shared demo picker (features/auth/DemoPickerHost.tsx), the same dialog the header's and the footer's Get Started open.
 * There is no Log In anywhere on the signed-out chrome any more.
 *
 * Designed for a phone first and stretched for a desktop. A signed-in visitor never renders this: Page.tsx shows the
 * signed-in home at `/` instead. */

import { CalendarClock, ClipboardCheck, ScanLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import appScreenshot from '../assets/landing-calendar.webp'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Container } from '../components/ui/Container'
import { openDemoPicker } from '../lib/demoPickerTrigger'

const FEATURES = [
  { id: 'capture', icon: ScanLine },
  { id: 'review', icon: ClipboardCheck },
  { id: 'remember', icon: CalendarClock },
] as const

/** A real screenshot of the app (the Calendar, signed in as the demo owner) in a plain phone frame: a dark bezel, rounded
 * screen, a small speaker slot. Not a mockup of a screen that does not exist. */
function PhoneFrame() {
  const { t } = useTranslation()
  return (
    <figure className="mx-auto w-[236px] sm:w-[264px] lg:mx-0 lg:justify-self-center" data-testid="hero-phone">
      <div className="relative rounded-[2rem] bg-ink p-[7px] shadow-[0_24px_60px_-20px_rgba(20,20,20,0.45)]">
        <span className="absolute left-1/2 top-[13px] z-10 h-[5px] w-14 -translate-x-1/2 rounded-full bg-black/70" aria-hidden="true" />
        <div className="overflow-hidden rounded-[1.4rem] bg-white">
          <img
            src={appScreenshot}
            alt={t('home.hero.imageAlt')}
            width={600}
            height={1299}
            fetchPriority="high"
            className="block h-auto w-full"
          />
        </div>
      </div>
    </figure>
  )
}

export function WelcomeHero() {
  const { t } = useTranslation()

  return (
    <section className="pb-16 pt-8 sm:pt-14">
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16">
          <div>
            <h1 className="max-w-xl text-[34px] font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
              {t('home.hero.headline')}
            </h1>
            <p className="mt-4 max-w-xl text-[17px] leading-7 text-muted sm:text-lg sm:leading-8">{t('home.hero.subhead')}</p>
            <div className="mt-7">
              <Button size="md" className="w-full sm:w-auto" onClick={openDemoPicker} aria-haspopup="dialog">
                {t('home.demo.button')}
              </Button>
              <p className="mt-2 text-[14px] text-muted">{t('home.demo.hint')}</p>
            </div>
          </div>
          <PhoneFrame />
        </div>

        <ul className="mt-14 grid gap-3 sm:grid-cols-3">
          {FEATURES.map(({ id, icon: Icon }) => (
            <li key={id}>
              <Card className="h-full p-5" interactive={false}>
                <Icon size={22} strokeWidth={1.75} className="text-sage-ink" aria-hidden="true" />
                <h2 className="mt-3 text-[16px] font-semibold text-ink">{t(`home.features.${id}.title`)}</h2>
                <p className="mt-1 text-[15px] leading-6 text-muted">{t(`home.features.${id}.text`)}</p>
              </Card>
            </li>
          ))}
        </ul>

        <section className="mt-16 text-center" data-testid="closing">
          <p className="mx-auto max-w-md text-[26px] font-semibold leading-tight tracking-tight text-ink sm:text-3xl">{t('home.closing')}</p>
          <Button size="md" className="mt-6 w-full sm:w-auto" onClick={openDemoPicker} aria-haspopup="dialog">
            {t('home.demo.button')}
          </Button>
        </section>
      </Container>
    </section>
  )
}
