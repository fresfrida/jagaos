import { useEffect, useState, type RefObject } from 'react'

/** While a NEW page loads, the height of the page it replaced, so the footer stays where it was instead of jumping up under a
 * half-loaded page and back down as the data arrives (DECISIONS #112). `undefined` means "reserve nothing": on the very first
 * load, and once the new page has settled (`settled`, hooks/usePageSettled.ts), when the reservation is let go and the page is
 * exactly as tall as its content again (DECISIONS #108's rule is unchanged: no standing minimum height).
 *
 * The previous height is read DURING the render in which `pageKey` changes: React has not committed the new page yet, so the DOM
 * still holds the old one and `offsetHeight` is the height the person was just looking at. The reservation is then part of the same
 * commit as the new page, so there is no frame in which the footer is in the wrong place.
 *
 * `settled` is deliberately the only dependency of the release effect: in the render that changes `pageKey`, `settled` is still the
 * OLD page's `true` (usePageSettled resets it in an effect), and releasing then would undo the reservation at once. */
export function useReservedPageHeight(pageKey: string, settled: boolean, target: RefObject<HTMLElement | null>): number | undefined {
  const [seenKey, setSeenKey] = useState(pageKey)
  const [reserved, setReserved] = useState<number | undefined>(undefined)

  if (pageKey !== seenKey) {
    setSeenKey(pageKey)
    const height = target.current?.offsetHeight
    setReserved(height && height > 0 ? height : undefined)
  }

  useEffect(() => {
    if (settled) setReserved(undefined)
  }, [settled])

  return reserved
}
