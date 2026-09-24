import { describe, expect, it } from 'vitest'
import { hintLabel, hintSlugFromSearch, uploadHrefFor } from './uploadHint'

describe('hintSlugFromSearch', () => {
  it('reads the slug', () => {
    expect(hintSlugFromSearch('?for=constitution')).toBe('constitution')
    expect(hintSlugFromSearch('?x=1&for=share_register')).toBe('share_register')
  })

  it('is null when absent, empty or not slug-shaped', () => {
    expect(hintSlugFromSearch('')).toBeNull()
    expect(hintSlugFromSearch('?for=')).toBeNull()
    expect(hintSlugFromSearch('?for=Company%20Constitution')).toBeNull()
    expect(hintSlugFromSearch('?for=../../etc')).toBeNull()
    expect(hintSlugFromSearch(`?for=${'a'.repeat(61)}`)).toBeNull()
  })
})

describe('uploadHrefFor', () => {
  it('points at the upload page with the slug', () => {
    expect(uploadHrefFor('annual_return')).toBe('/upload?for=annual_return')
  })

  it('round-trips through the parser', () => {
    expect(hintSlugFromSearch(uploadHrefFor('agm_minutes').split('?')[1] ? `?${uploadHrefFor('agm_minutes').split('?')[1]}` : '')).toBe('agm_minutes')
  })
})

describe('hintLabel', () => {
  const expectations = [
    { doc_type: 'constitution', label: 'Company Constitution' },
    { doc_type: 'annual_return', label: 'First Annual Return' },
  ]

  it('finds the checklist label for the slug', () => {
    expect(hintLabel('constitution', expectations)).toBe('Company Constitution')
  })

  it('is null for no hint, or a slug this company has no checklist item for', () => {
    expect(hintLabel(null, expectations)).toBeNull()
    expect(hintLabel('share_register', expectations)).toBeNull()
    expect(hintLabel('constitution', [])).toBeNull()
  })
})
