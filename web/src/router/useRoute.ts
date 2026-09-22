import { useEffect, useState } from 'react'
import { parsePath, type ResolvedRoute } from './routes'

/** Current route, derived from the URL path. Updates on link clicks (navigate) and back/forward. */
export function useRoute(): ResolvedRoute {
  const [route, setRoute] = useState<ResolvedRoute>(() => parsePath(window.location.pathname))

  useEffect(() => {
    const sync = () => setRoute(parsePath(window.location.pathname))
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  return route
}
