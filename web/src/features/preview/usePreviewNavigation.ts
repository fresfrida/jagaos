import { useCallback, useEffect, useState } from 'react'
import type { PreviewMode } from './types'

const isMode = (value: string): value is PreviewMode => value === 'calendar' || value === 'tags'

function modeFromHash(): PreviewMode | null {
  const hash = window.location.hash.slice(1)
  return isMode(hash) ? hash : null
}

/**
 * Owns which preview frame is showing and keeps it in the URL hash (#calendar, #tags),
 * so the frames are linkable, deep-linkable and work with the back button.
 */
export function usePreviewNavigation() {
  const [mode, setMode] = useState<PreviewMode>(() => modeFromHash() ?? 'calendar')
  const [activationKey, setActivationKey] = useState(0)

  /** Show a frame: switch mode, scroll to it, move focus to its tab. */
  const reveal = useCallback((next: PreviewMode) => {
    setMode(next)
    setActivationKey((k) => k + 1)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById('product')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus({ preventScroll: true }))
  }, [])

  /** A link or button was activated: record it in the URL, then reveal the frame. */
  const open = useCallback(
    (next: PreviewMode) => {
      if (modeFromHash() !== next) window.history.pushState(null, '', `#${next}`)
      reveal(next)
    },
    [reveal],
  )

  /** The user switched tabs inside the frame: update the URL quietly, no scroll, no new history entry. */
  const switchTab = useCallback((next: PreviewMode) => {
    setMode(next)
    window.history.replaceState(null, '', `#${next}`)
  }, [])

  useEffect(() => {
    const initial = modeFromHash()
    if (initial) reveal(initial) // deep link on first load
    const onHashChange = () => {
      const next = modeFromHash()
      if (next) reveal(next) // back/forward or manual hash edit
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [reveal])

  return { mode, activationKey, open, switchTab }
}
