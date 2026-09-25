/** Remembers where each history entry was scrolled to, and puts the page back there on Back (2026-09-25, DECISIONS #106).
 *
 * Why it exists: a Calendar day-list row leaves the page for Company Files (DECISIONS #105). Back restored the month, the
 * tapped day and the basis (they are in the URL) but the page opened at the TOP, so the row you came from was somewhere below.
 * The browser's own scroll restoration cannot do it: this is a single-page app, so the page is empty for a moment after Back and
 * its list arrives from the API later, and an early restore is clamped to the short page. So the app does it itself:
 *
 *  - SAVE: the scroll position goes into `history.state` (`{ scrollY }`) of the entry it belongs to: a moment after scrolling
 *    stops, and immediately before `navigate()` pushes a new entry (rememberScroll), so a click right after a scroll cannot leave
 *    a stale value. `replaceState`, so it adds no history entry, and it keeps whatever else is in the state.
 *  - RESTORE: on a route change whose entry has a saved position (Back, Forward, a reload), scroll there once the page is tall
 *    enough to reach it, polling for a few seconds; a person who scrolls, taps or presses a key first is not fought.
 *    A pushed entry has no saved position, so a new page still opens at the top.
 *  - `history.scrollRestoration` is set to `manual`, or the browser would also restore, at its own moment. */

const SAVE_DELAY_MS = 200
const POLL_MS = 50
const GIVE_UP_MS = 4000
const USER_INPUT_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const

let saveTimer: number | undefined

function currentState(): Record<string, unknown> {
  const state: unknown = window.history.state
  return state !== null && typeof state === 'object' ? (state as Record<string, unknown>) : {}
}

/** Writes the current scroll position into the current history entry, now. */
export function rememberScroll(): void {
  window.clearTimeout(saveTimer)
  saveTimer = undefined
  try {
    window.history.replaceState({ ...currentState(), scrollY: Math.round(window.scrollY) }, '')
  } catch {
    // Browsers rate-limit history writes (Safari throws past about 100 in 30s): the page then opens at the top next time.
  }
}

/** The position saved in the current entry, or null when there is none or it is the top. */
export function savedScrollY(): number | null {
  const y = currentState().scrollY
  return typeof y === 'number' && Number.isFinite(y) && y > 0 ? y : null
}

/** Starts remembering scroll positions. Call once, from the app root; returns a cleanup. */
export function startScrollMemory(): () => void {
  const previous = window.history.scrollRestoration
  window.history.scrollRestoration = 'manual'
  const onScroll = () => {
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(rememberScroll, SAVE_DELAY_MS)
  }
  // A save still pending when the entry changes would write the page we are LEAVING into the one we are arriving at.
  const onPop = () => {
    window.clearTimeout(saveTimer)
    saveTimer = undefined
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('popstate', onPop)
  return () => {
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('popstate', onPop)
    window.clearTimeout(saveTimer)
    window.history.scrollRestoration = previous
  }
}

/** Scrolls to `y` as soon as the page is tall enough to reach it. If it never gets that tall (the content shrank, the list is
 * shorter now) it goes as far as the page goes after a few seconds. Stops early if the person scrolls, taps or presses a key.
 * Returns a cancel function. */
export function restoreScrollWhenReady(y: number): () => void {
  const startedAt = Date.now()
  const tallEnough = () => document.documentElement.scrollHeight - window.innerHeight >= y - 1
  const stop = () => {
    window.clearInterval(poll)
    for (const type of USER_INPUT_EVENTS) window.removeEventListener(type, stop)
  }
  const tick = () => {
    if (tallEnough()) {
      window.scrollTo(0, y)
      stop()
    } else if (Date.now() - startedAt >= GIVE_UP_MS) {
      window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - window.innerHeight))
      stop()
    }
  }
  const poll = window.setInterval(tick, POLL_MS)
  for (const type of USER_INPUT_EVENTS) window.addEventListener(type, stop, { once: true, passive: true })
  tick()
  return stop
}
