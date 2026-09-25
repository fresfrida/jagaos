import { useEffect, useRef } from 'react'
import { pageTitle, type ResolvedRoute } from './routes'
import { restoreScrollWhenReady, savedScrollY, startScrollMemory } from './scrollMemory'

/** On every route change: update the tab title, put the page where it was left or at the top, and move focus to <main> for
 * screen readers. "Where it was left" is a position saved in the history entry (Back, Forward, a reload); a page reached by a
 * link is a new entry with none, so it opens at the top (router/scrollMemory.ts). */
export function useRouteEffects(route: ResolvedRoute): void {
  const isFirstRender = useRef(true)

  useEffect(() => startScrollMemory(), [])

  useEffect(() => {
    document.title = pageTitle(route)
    const saved = savedScrollY()
    if (isFirstRender.current) {
      isFirstRender.current = false
      // A reload, or coming back from another site: put the page where it was, if it was saved.
      return saved !== null ? restoreScrollWhenReady(saved) : undefined
    }
    document.getElementById('main')?.focus({ preventScroll: true })
    if (saved !== null) return restoreScrollWhenReady(saved)
    window.scrollTo(0, 0)
  }, [route])
}
