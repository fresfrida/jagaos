import { useEffect, useRef } from 'react'
import { pageTitle, type ResolvedRoute } from './routes'

/** On every route change: update the tab title, scroll to top, and move focus to <main> for screen readers. */
export function useRouteEffects(route: ResolvedRoute): void {
  const isFirstRender = useRef(true)

  useEffect(() => {
    document.title = pageTitle(route)
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    window.scrollTo(0, 0)
    document.getElementById('main')?.focus({ preventScroll: true })
  }, [route])
}
