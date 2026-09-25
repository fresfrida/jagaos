import { describe, expect, it } from 'vitest'
import { companyFilesDocumentHref, documentIdFromParams } from './documentLinks'

describe('document links into Company Files (DECISIONS #105)', () => {
  it('builds the link and reads the same id back', () => {
    expect(companyFilesDocumentHref(42)).toBe('/company-files?doc=42')
    expect(documentIdFromParams(new URLSearchParams(companyFilesDocumentHref(42).split('?')[1]))).toBe(42)
  })

  it('accepts only a positive whole number, so a hand-edited link cannot smuggle anything else in', () => {
    const id = (raw: string) => documentIdFromParams(new URLSearchParams({ doc: raw }))
    expect(id('7')).toBe(7)
    for (const bad of ['', '0', '-3', '1.5', 'abc', '3abc', '1e3', ' 4', '007']) expect(id(bad)).toBeNull()
    expect(documentIdFromParams(new URLSearchParams())).toBeNull()
  })
})
