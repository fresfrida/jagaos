/** Whether this browser can show a PDF INSIDE the page, in an `<embed>` or an `<iframe>` (round 3, item 1, DECISIONS #121).
 * Desktop Chrome, Edge, Firefox and Safari can; Android Chrome and Brave, and any browser with its PDF viewer switched off, cannot,
 * and an `<embed>` there falls back to the browser's own "cannot preview" box, which names the file by the blob's opaque UUID.
 *
 * `navigator.pdfViewerEnabled` is the standard flag for exactly this question (Chrome 94, Firefox 99, Safari 16.4). It is used in
 * preference to a screen-width breakpoint because a width only guesses at the capability: a large Android tablet is wider than any
 * phone and still has no viewer, and a narrow desktop window is narrow and still has one. A browser too old to report it (the
 * property is `undefined`) is treated as able, which keeps today's behaviour for it. Only an explicit `false` means "cannot". */
export function canShowPdfInline(): boolean {
  return typeof navigator === 'undefined' || navigator.pdfViewerEnabled !== false
}
