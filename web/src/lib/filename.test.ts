import { describe, expect, it } from 'vitest'
import { DEFAULT_FILENAME_MAX, middleEllipsis } from './filename'

describe('middleEllipsis', () => {
  it('leaves a name that fits exactly as it is', () => {
    expect(middleEllipsis('invoice.pdf')).toBe('invoice.pdf')
    expect(middleEllipsis('a'.repeat(DEFAULT_FILENAME_MAX))).toBe('a'.repeat(DEFAULT_FILENAME_MAX))
  })

  it('cuts the middle and keeps the start, the tail and the extension', () => {
    const shortened = middleEllipsis('invoice-2026-09-supplier-final-version.pdf', 24)
    expect(shortened).toMatch(/^invoice-.*….*\.pdf$/)
    expect(shortened.endsWith('sion.pdf') || shortened.endsWith('ersion.pdf') || shortened.endsWith('rsion.pdf')).toBe(true)
    expect(Array.from(shortened).length).toBeLessThanOrEqual(24)
  })

  it('never exceeds the budget, for any length', () => {
    for (const max of [8, 12, 20, 28, 40]) {
      const out = middleEllipsis('IMG_20260924_183045_a-very-long-photo-name-indeed.jpeg', max)
      expect(Array.from(out).length).toBeLessThanOrEqual(max)
    }
  })

  it('keeps an extension of up to five letters and treats a longer "extension" as part of the name', () => {
    expect(middleEllipsis('x'.repeat(40) + '.jpeg', 20).endsWith('.jpeg')).toBe(true)
    expect(middleEllipsis('a'.repeat(40) + '.notanextension', 20).endsWith('.notanextension')).toBe(false)
  })

  it('cuts a name with no extension in the middle too', () => {
    const out = middleEllipsis('a-long-document-name-without-any-extension-at-all', 20)
    expect(out).toContain('…')
    expect(Array.from(out).length).toBeLessThanOrEqual(20)
    expect(out.startsWith('a-long')).toBe(true)
  })

  it('does not split a character made of two UTF-16 units', () => {
    const out = middleEllipsis('\u{1F4C4}'.repeat(30) + '.pdf', 12)
    expect(Array.from(out).every((ch) => ch === '\u{1F4C4}' || ch === '…' || '.pdf'.includes(ch))).toBe(true)
  })

  it('handles CJK names by character, not by byte', () => {
    const out = middleEllipsis('公司章程修订版本一二三四五六.pdf', 10)
    expect(Array.from(out).length).toBeLessThanOrEqual(10)
    expect(out.endsWith('.pdf')).toBe(true)
  })

  it('degrades to a plain cut when there is no room for a middle', () => {
    expect(Array.from(middleEllipsis('averylongname.pdf', 5)).length).toBeLessThanOrEqual(5)
  })

  it('is a no-op for an empty name', () => {
    expect(middleEllipsis('')).toBe('')
  })
})
