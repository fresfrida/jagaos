/** Signed-out landing (round 16, item 2; the round 9 version was a centred heading and two buttons that both went to
 * /login; reworked in round 21, Part B, DECISIONS #101 into a quiet commercial page; the "How it works" strip was removed in
 * DECISIONS #106).
 *
 * Register: Apple's. Short sentences, no exclamation marks, no superlatives; the product steps back and the owner's life
 * steps forward. The page, top to bottom: a headline and one supporting sentence with the one call to action (a demo, through
 * the ordinary login: features/auth/useDemoLogin.ts, config/demo.ts, no bypass), a screen recording of the app in a plain phone
 * frame (a still under reduced motion), and three cards (Capture, Review, Remember); the page ends there, straight into the footer (the closing line and its
 * second call to action were removed in DECISIONS #108). The button opens the shared demo picker
 * (features/auth/DemoPickerHost.tsx), the same dialog the header's and the footer's Get Started open.
 * There is no Log In anywhere on the signed-out chrome any more.
 *
 * Designed for a phone first and stretched for a desktop. A signed-in visitor never renders this: Page.tsx shows the
 * signed-in home at `/` instead. */

import { CalendarClock, ClipboardCheck, ScanLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Container } from '../components/ui/Container'
import { useDemoVideo } from '../hooks/useDemoVideo'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { openDemoPicker } from '../lib/demoPickerTrigger'
import { HERO_POSTER, HERO_VIDEO_SIZE, HeroVideo, HeroVideoToggle } from './HeroVideo'

const FEATURES = [
  { id: 'capture', icon: ScanLine },
  { id: 'review', icon: ClipboardCheck },
  { id: 'remember', icon: CalendarClock },
] as const

/** The app in a plain phone frame: a dark bezel, rounded screen, a small speaker slot. What plays in it is a screen recording of the
 * LIVE app (sections/HeroVideo.tsx, DECISIONS #113), not a mockup of a screen that does not exist; where the person asked for reduced
 * motion it is the recording's first frame, a still, and nothing moves. */
function PhoneFrame() {
  const { t } = useTranslation()
  const reducedMotion = usePrefersReducedMotion()
  const demo = useDemoVideo()
  return (
    <figure className="mx-auto w-[236px] sm:w-[264px] lg:mx-0 lg:justify-self-center" data-testid="hero-phone">
      <div className="relative rounded-[2rem] bg-ink p-[7px] shadow-[0_24px_60px_-20px_rgba(20,20,20,0.45)]">
        <span className="absolute left-1/2 top-[13px] z-10 h-[5px] w-14 -translate-x-1/2 rounded-full bg-black/70" aria-hidden="true" />
        <div className="overflow-hidden rounded-[1.4rem] bg-white">
          {reducedMotion ? (
            <img
              src={HERO_POSTER}
              alt={t('home.hero.imageAlt')}
              width={HERO_VIDEO_SIZE.width}
              height={HERO_VIDEO_SIZE.height}
              fetchPriority="high"
              className="block h-auto w-full"
            />
          ) : (
            <HeroVideo demo={demo} />
          )}
        </div>
      </div>
      {/* Under reduced motion there is a still and nothing to pause; and no button if no source can be played (DECISIONS #115). */}
      {!reducedMotion && !demo.unavailable && <HeroVideoToggle demo={demo} />}
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
              {/* 16px, up from 14 (DECISIONS #111): the line under the button read as fine print. Same colour. */}
              <p className="mt-2 text-base leading-6 text-muted">{t('home.demo.hint')}</p>
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
                {/* font-semibold, the title's own weight (DECISIONS #111): the title still leads by colour (ink vs muted), size and
                   face; bold would make the description heavier than the title above it. */}
                <p className="mt-1 text-[15px] font-semibold leading-6 text-muted">{t(`home.features.${id}.text`)}</p>
              </Card>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  )
}
