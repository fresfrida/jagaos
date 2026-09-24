/** Pure rules for what a file selection on the Upload page means (2026-09-24,
 * round 12, DECISIONS #78) — kept apart from the components so they are
 * testable without rendering.
 *
 * Choosing DOCUMENT can select several files. One file uploads as it always
 * has. Two or more must all be photos, and become the ordered pages of ONE
 * document (the backend merges them into a single PDF). */

/** Mirrors app/extract/ocr.py's MAX_PDF_OCR_PAGES — the cap the backend's
 * OCR already applies, so a longer set would silently lose its later pages.
 * tests/test_page_cap.py fails if the two numbers drift. */
export const MAX_PAGES = 10

export type SelectionError = 'mixed' | 'tooMany'

export type DocumentSelection =
  | { kind: 'none' }
  | { kind: 'single'; file: File }
  | { kind: 'pages'; files: File[] }
  | { kind: 'error'; error: SelectionError }

export function isImage(file: File): boolean {
  return file.type.startsWith('image/')
}

/** What a multi-select from the DOCUMENT picker means. */
export function interpretDocumentSelection(files: File[]): DocumentSelection {
  const [first] = files
  if (first === undefined) return { kind: 'none' }
  if (files.length === 1) return { kind: 'single', file: first }
  // A PDF can't be a page of a merged photo set, and two PDFs are two documents.
  if (!files.every(isImage)) return { kind: 'error', error: 'mixed' }
  if (files.length > MAX_PAGES) return { kind: 'error', error: 'tooMany' }
  return { kind: 'pages', files }
}

/** Adds more pages after the ones already chosen. Non-images are refused
 * rather than dropped quietly, and so is going past the page cap. */
export function appendPages(
  existing: File[],
  added: File[],
): { files: File[]; error: SelectionError | null } {
  if (!added.every(isImage)) return { files: existing, error: 'mixed' }
  if (existing.length + added.length > MAX_PAGES) return { files: existing, error: 'tooMany' }
  return { files: [...existing, ...added], error: null }
}

/** A new array with the page at `from` moved `delta` places (negative = earlier).
 * Out-of-range moves return the same order. */
export function movePage<T>(pages: T[], from: number, delta: number): T[] {
  const to = from + delta
  if (from < 0 || from >= pages.length || to < 0 || to >= pages.length) return pages
  const next = [...pages]
  const moved = next.splice(from, 1)
  next.splice(to, 0, ...moved)
  return next
}

export function removePage<T>(pages: T[], index: number): T[] {
  return pages.filter((_, i) => i !== index)
}
