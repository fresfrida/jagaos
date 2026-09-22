/** Client-side navigation: push the URL, then tell useRoute (popstate is what it listens to). */
export function navigate(path: string): void {
  if (path !== window.location.pathname) window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
