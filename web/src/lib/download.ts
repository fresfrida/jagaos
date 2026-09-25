/** Starts a real NETWORK download of `url` (round 4, item 3, DECISIONS #122). The server answers such a URL with
 * `Content-Disposition: attachment; filename=...` (GET /api/documents/{id}/download), so the browser saves the file under its real name
 * and the page stays where it is, whatever the browser. It is the ONLY kind of download that completes on Android Chrome and Brave:
 * every in-memory one (a `blob:` anchor, `blob:` through window.open, a `data:` URL) was interrupted there, on HTTP and HTTPS, in a
 * measured test. Call it from a tap; it needs no `download` attribute because the response itself says it is an attachment. */
export function startDownload(url: string): void {
  const link = document.createElement('a')
  link.href = url
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
}
