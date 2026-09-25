import { useCallback, useRef, useState, type RefObject, type SyntheticEvent } from 'react'

export interface DemoVideo {
  /** For the `<video>`. */
  ref: RefObject<HTMLVideoElement | null>
  /** Whether it is playing NOW, from the element's own events, so it is true to what is on screen. Starts true: the video autoplays. */
  playing: boolean
  /** No source could be played (a browser without the codec, a broken file): a control for it would do nothing. */
  unavailable: boolean
  /** Pause it, showing the frame it stopped on; or play it again. */
  toggle: () => void
  /** The video's `onPlay`, `onPause` and `onError`, and what to call when `play()` is refused. */
  onPlay: () => void
  onPause: () => void
  onError: (event: SyntheticEvent) => void
  onBlocked: () => void
}

/** State and actions for the landing page's demo video and its pause button (DECISIONS #115; WCAG 2.2.2: a video that starts by itself
 * and loops for more than five seconds needs a way to stop it). Kept apart from the two components that use it, `HeroVideo` (the
 * picture) and `HeroVideoToggle` (the button), which sit in different places in the phone frame.
 *
 * `playing` follows the element's own `play` and `pause` events rather than a flag flipped on click, so it stays right when the
 * browser pauses a video by itself (scrolled out of view, low-power mode) and when it refuses to autoplay at all: then the
 * button reads "Play" and starts it. */
export function useDemoVideo(): DemoVideo {
  const ref = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(true)
  const [unavailable, setUnavailable] = useState(false)

  const onBlocked = useCallback(() => setPlaying(false), [])

  const toggle = useCallback(() => {
    const video = ref.current
    if (!video) return
    if (video.paused) {
      const started = video.play()
      if (started !== undefined) started.catch(onBlocked) // jsdom returns nothing
    } else {
      video.pause()
    }
  }, [onBlocked])

  return {
    ref,
    playing,
    unavailable,
    toggle,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onError: () => setUnavailable(true),
    onBlocked,
  }
}
