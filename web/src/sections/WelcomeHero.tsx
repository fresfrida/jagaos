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
 * signed-in home at `/` instead.
 *
 * Round 3 (DECISIONS #121), spacing and one background, nothing else: from `lg` the left column's rhythm is opened up (top padding 56 to 80px,
 * headline to subhead 16 to 24, subhead to button 28 to 44, button to hint 8 to 12), because the phone frame beside it grew taller once its
 * pause button and caption were added (656px against a 290px column, measured at 1280 and 1440) and the column read as cramped next to it; phone
 * and tablet spacing are unchanged. And one soft sage wash sits behind the hero (`.hero-wash`, index.css), on its own layer so the cards,
 * which paint an opaque white, stay pure white. */

import { motion, type Variants } from 'framer-motion'
import { CalendarClock, ClipboardCheck, ScanLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Container } from '../components/ui/Container'
import { cn } from '../lib/cn'
import { useDemoVideo } from '../hooks/useDemoVideo'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { openDemoPicker } from '../lib/demoPickerTrigger'
import { HERO_POSTER, HERO_VIDEO_SIZE, HeroVideo, HeroVideoToggle } from './HeroVideo'

const FEATURES = [
  { id: 'capture', icon: ScanLine },
  { id: 'review', icon: ClipboardCheck },
  { id: 'remember', icon: CalendarClock },
] as const

/** The one-time load-in (round 4, item 8b, DECISIONS #122): plays once when `WelcomeHero` mounts, not on every re-render or a
 * route revisit within the same mount (framer-motion's `initial`/`animate` only fire on the first render of an instance,
 * never replayed by a later re-render — a language switch does not restart it). `MotionConfig reducedMotion="user"` at the
 * app's root (App.tsx) already turns every `motion.*` transform into an instant, opacity-only change under reduced motion,
 * so nothing extra is needed here for that. HEADING is the true orchestrator (only it carries `initial`/`animate`); TEXT_GROUP
 * and PHONE are nested containers so the headline, subhead and CTA stagger first (about 0.06s apart, ~0.28s each), and the
 * phone frame rises in last, overlapping their tail — about 400ms end to end. */
const HEADING: Variants = { hidden: {}, visible: { transition: { staggerChildren: 0.06, delayChildren: 0 } } }
const TEXT_ITEM: Variants = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.28, ease: 'easeOut' } } }
const PHONE_ITEM: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.28, ease: 'easeOut', delay: 0.16 } },
}

/** The app in a plain phone frame: a dark bezel, rounded screen, a small speaker slot. What plays in it is a screen recording of the
 * LIVE app (sections/HeroVideo.tsx, DECISIONS #113), not a mockup of a screen that does not exist; where the person asked for reduced
 * motion it is the recording's first frame, a still, and nothing moves. */
function PhoneFrame() {
  const { t } = useTranslation()
  const reducedMotion = usePrefersReducedMotion()
  const demo = useDemoVideo()
  const showToggle = !reducedMotion && !demo.unavailable
  return (
    <motion.figure
      variants={PHONE_ITEM}
      className="mx-auto w-[236px] sm:w-[264px] lg:mx-0 lg:w-[312px] lg:justify-self-center"
      data-testid="hero-phone"
    >
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
      {showToggle && <HeroVideoToggle demo={demo} />}
      {/* What the picture is, in one line (DECISIONS #118), under the video and its button. A real <figcaption> of this <figure>: Chromium's
         accessibility tree exposes it as the figure's Figcaption, read after the video and its button. It does NOT give the figure a name
         (checked); the video keeps its own label (home.hero.videoAlt). */}
      <figcaption className={cn('text-center text-sm leading-5 text-muted', showToggle ? 'mt-1' : 'mt-3')}>{t('home.hero.caption')}</figcaption>
    </motion.figure>
  )
}

export function WelcomeHero() {
  const { t } = useTranslation()

  return (
    <section className="relative isolate pb-16 pt-8 sm:pt-14 lg:pt-20">
      {/* The wash: a decoration behind the hero only, not the page. `isolate` + `-z-10` keep it under everything in this section. */}
      <div className="hero-wash pointer-events-none absolute inset-x-0 top-0 -z-10 h-[56rem]" aria-hidden="true" data-testid="hero-wash" />
      <Container>
        <motion.div
          variants={HEADING}
          initial="hidden"
          animate="visible"
          className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-16"
        >
          <motion.div variants={HEADING}>
            <motion.h1
              variants={TEXT_ITEM}
              className="max-w-xl text-[34px] font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl"
            >
              {t('home.hero.headline')}
            </motion.h1>
            <motion.p variants={TEXT_ITEM} className="mt-4 max-w-xl text-[17px] leading-7 text-muted sm:text-lg sm:leading-8 lg:mt-6">
              {t('home.hero.subhead')}
            </motion.p>
            <motion.div variants={TEXT_ITEM} className="mt-7 lg:mt-11">
              <Button size="md" className="w-full sm:w-auto" onClick={openDemoPicker} aria-haspopup="dialog">
                {t('home.demo.button')}
              </Button>
              {/* 16px, up from 14 (DECISIONS #111): the line under the button read as fine print. Same colour. */}
              <p className="mt-2 text-base leading-6 text-muted lg:mt-3">{t('home.demo.hint')}</p>
            </motion.div>
          </motion.div>
          <PhoneFrame />
        </motion.div>

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
