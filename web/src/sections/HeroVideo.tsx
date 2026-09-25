/** The landing page's demo video (DECISIONS #113): a screen recording of the LIVE app, in the phone frame. Signed in as the demo owner
 * on a phone-sized screen, it scrolls the Calendar, then switches the language selector through Chinese, Malay and Tamil while the
 * page updates, and ends on the frame it began on so the loop has no jump. Captured from the running app at 2x, not drawn:
 * `docs/HANDOFF.md` has how it was made and how to make it again.
 *
 * A plain `<video>`: muted, looping, `playsInline` (iOS would otherwise take it full screen), autoplaying. Two encodings, H.264 first
 * (every current browser, iOS included) and VP9 as the fallback for a browser built without H.264, each under 300KB. The poster is
 * the first frame of the video, so before the video loads, or where a browser will not autoplay it (low-power or data-saver modes),
 * the phone shows the same picture the video opens on. `WelcomeHero` swaps this whole element for that poster as an `<img>` when
 * the person asked for reduced motion.
 *
 * `HeroVideoToggle` is its pause button (DECISIONS #115): under the phone frame, an icon and a word ("Pause video" / "Play video",
 * translated), so the name a screen reader gives is the one a person sees. It pauses on the frame it is at and plays on. */

import { Pause, Play } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import demoMp4 from '../assets/landing-demo.mp4'
import demoWebm from '../assets/landing-demo.webm'
import demoPoster from '../assets/landing-demo-poster.webp'
import { Button } from '../components/ui/Button'
import type { DemoVideo } from '../hooks/useDemoVideo'

export const HERO_POSTER = demoPoster
/** The recording's size in pixels: the frame reserves this aspect ratio, so nothing jumps when the video arrives. */
export const HERO_VIDEO_SIZE = { width: 600, height: 1300 } as const
/** How fast the recording plays (DECISIONS #118). It is muted, so there is no audio to keep in step, and the loop still ends on the frame
 * it began on: the rate changes how fast the content goes by, not the content. */
export const HERO_PLAYBACK_RATE = 1.8

export function HeroVideo({ demo }: { demo: DemoVideo }) {
  const { t } = useTranslation()
  const { ref, onBlocked } = demo

  useEffect(() => {
    const element = ref.current
    if (!element) return
    // React sets `muted` as a property, after the element exists; some browsers only autoplay a video that is muted by then.
    element.muted = true
    // `defaultPlaybackRate` too: a browser that reloads the media resets `playbackRate` to it, and the pause button's play() must not slow the video down.
    element.defaultPlaybackRate = HERO_PLAYBACK_RATE
    element.playbackRate = HERO_PLAYBACK_RATE
    const started = element.play()
    // A browser that refuses (low-power mode, data saver) leaves the poster showing and the button reading "Play". jsdom returns nothing.
    if (started !== undefined) started.catch(onBlocked)
  }, [ref, onBlocked])

  return (
    <video
      ref={ref}
      autoPlay
      loop
      muted
      playsInline
      preload="auto"
      poster={demoPoster}
      width={HERO_VIDEO_SIZE.width}
      height={HERO_VIDEO_SIZE.height}
      aria-label={t('home.hero.videoAlt')}
      onPlay={demo.onPlay}
      onPause={demo.onPause}
      onError={demo.onError}
      className="block h-auto w-full"
    >
      <source src={demoMp4} type="video/mp4" />
      {/* Last source: if this one fails too, nothing plays, and the button has nothing to control. */}
      <source src={demoWebm} type="video/webm" onError={demo.onError} />
    </video>
  )
}

/** The pause / play button under the phone frame. A 44px tap target, like the app's other phone controls. */
export function HeroVideoToggle({ demo }: { demo: DemoVideo }) {
  const { t } = useTranslation()
  const label = t(demo.playing ? 'home.hero.pauseVideo' : 'home.hero.playVideo')
  return (
    <div className="mt-3 flex justify-center">
      <Button
        variant="ghost"
        size="sm"
        className="min-h-[44px]"
        onClick={demo.toggle}
        icon={demo.playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
      >
        {label}
      </Button>
    </div>
  )
}
