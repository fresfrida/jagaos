import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined
  const query = window.matchMedia(QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const getSnapshot = (): boolean => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches

/** True when the person's system asks for reduced motion, and it follows the setting if it changes while the page is open.
 * The app's other motion honours it already, by CSS (`motion-reduce:`, `@media (prefers-reduced-motion)` in index.css) and by
 * `MotionConfig reducedMotion="user"` in App.tsx; neither can take a `<video>` off the page, which is what the landing page's
 * demo video needs (it swaps to a still). No `matchMedia` (an old browser, a test) reads as "no preference". */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
