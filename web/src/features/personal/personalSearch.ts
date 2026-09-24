/** The Only me section's own search (2026-09-25, round 19, DECISIONS #94): a pure
 * filter over the person's private files, run in the browser as they type. It is not
 * the company search: it never calls the server, never sees a company document, and
 * has no relation to GET /api/search (which no longer returns personal files at all).
 *
 * A file matches when EVERY word of the query appears somewhere in its searchable
 * text: the filename, its description in every language it has (so a Malay caption is
 * found from English UI too), the vendor, the document type and the bucket. Case and
 * accents are ignored. An empty query matches everything. */

import type { DocumentRow } from '../ops/opsApi'

/** Lower-case and strip diacritics, so "Café" is found by "cafe" and "TAN" by "tan". */
export function fold(text: string): string {
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Every language of a stored description, joined (the column holds {"en": ..., "ms": ...},
 * or, for an old row, plain text). Never throws on malformed data. */
function descriptionText(raw: string | null): string {
  if (!raw) return ''
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return Object.values(parsed as Record<string, unknown>).filter((v) => typeof v === 'string').join(' ')
  } catch {
    // an old plain-text description
  }
  return raw
}

/** The text a file is searched by. `bucketText` is the bucket as the person reads it
 * (translated), passed in so this stays free of i18n. */
export function searchableText(doc: DocumentRow, bucketText: string = doc.bucket ?? ''): string {
  return fold([doc.filename, descriptionText(doc.description), doc.vendor_name ?? '', doc.doc_type ?? '', doc.bucket ?? '', bucketText].join(' '))
}

export function filterPersonalFiles(
  docs: DocumentRow[],
  query: string,
  bucketLabelOf: (bucket: string) => string = (b) => b,
): DocumentRow[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return docs
  return docs.filter((doc) => {
    const text = searchableText(doc, doc.bucket ? bucketLabelOf(doc.bucket) : '')
    return words.every((word) => text.includes(word))
  })
}
