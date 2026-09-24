/** The Only me section's own search (round 19, DECISIONS #94): a pure, in-browser
 * filter over the person's private files. */

import { describe, expect, it } from 'vitest'
import type { DocumentRow } from '../ops/opsApi'
import { filterPersonalFiles, fold, searchableText } from './personalSearch'

const row = (id: number, over: Partial<DocumentRow> = {}): DocumentRow => ({
  id, filename: `file-${id}.pdf`, media_type: 'application/pdf', lane: 'invoice', doc_type: 'invoice', status: 'filed',
  received_at: '2026-09-25 05:00:00', description: null, bucket: null, vendor_name: null, occurred_on: null, visibility: 'only_me', ...over,
})

const docs = [
  row(1, { filename: 'Cafe-Receipt.jpg', description: JSON.stringify({ en: 'Lunch at Café Brûlée', ms: 'Makan tengah hari' }), vendor_name: 'Café Brûlée', doc_type: 'receipt', bucket: 'Expenses' }),
  row(2, { filename: 'tenancy.pdf', description: 'plain old text description', doc_type: 'statutory', bucket: 'Compliance' }),
  row(3, { filename: 'notes.png', description: '{not json', bucket: null }),
]

const ids = (found: DocumentRow[]) => found.map((d) => d.id)

describe('fold', () => {
  it('lower-cases and strips accents so a plain query finds an accented word', () => {
    expect(fold('Café BRÛLÉE')).toBe('cafe brulee')
  })
})

describe('filterPersonalFiles', () => {
  it('an empty or blank query returns every file, in the order given', () => {
    expect(ids(filterPersonalFiles(docs, ''))).toEqual([1, 2, 3])
    expect(ids(filterPersonalFiles(docs, '   '))).toEqual([1, 2, 3])
  })

  it('matches the filename, ignoring case', () => {
    expect(ids(filterPersonalFiles(docs, 'TENANCY'))).toEqual([2])
  })

  it('matches a description in ANY language it holds, so a Malay caption is found from an English query', () => {
    expect(ids(filterPersonalFiles(docs, 'tengah hari'))).toEqual([1])
    expect(ids(filterPersonalFiles(docs, 'lunch'))).toEqual([1])
  })

  it('ignores accents in both the file and the query', () => {
    expect(ids(filterPersonalFiles(docs, 'brulee'))).toEqual([1])
    expect(ids(filterPersonalFiles(docs, 'Café'))).toEqual([1])
  })

  it('needs EVERY word to match, in any order', () => {
    expect(ids(filterPersonalFiles(docs, 'receipt lunch'))).toEqual([1])
    expect(ids(filterPersonalFiles(docs, 'lunch tenancy'))).toEqual([])
  })

  it('matches the bucket by its translated label as well as its stored name', () => {
    const label = (bucket: string) => (bucket === 'Expenses' ? 'Perbelanjaan' : bucket)
    expect(ids(filterPersonalFiles(docs, 'perbelanjaan', label))).toEqual([1])
    expect(ids(filterPersonalFiles(docs, 'expenses', label))).toEqual([1])
  })

  it('reads a plain-text or malformed description without throwing', () => {
    expect(ids(filterPersonalFiles(docs, 'plain old'))).toEqual([2])
    expect(ids(filterPersonalFiles(docs, 'not json'))).toEqual([3])
    expect(searchableText(row(9, { description: '[1,2,3]' }))).toContain('file-9.pdf')
  })

  it('finds nothing for a word no file has', () => {
    expect(filterPersonalFiles(docs, 'zzz')).toEqual([])
  })
})
