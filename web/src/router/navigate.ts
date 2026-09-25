import { rememberScroll } from './scrollMemory'

/** Client-side navigation: push the URL, then tell useRoute (popstate is what it listens to). The page's scroll position is
 * saved into the entry being left first, so Back can put it there again (router/scrollMemory.ts). */
export function navigate(path: string): void {
  if (path !== window.location.pathname) {
    rememberScroll()
    window.history.pushState(null, '', path)
  }
  window.dispatchEvent(new PopStateEvent('popstate'))
}
