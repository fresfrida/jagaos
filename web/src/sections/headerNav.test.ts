import { describe, expect, it } from 'vitest'
import { accountMenuRoutes, canOfferUpload } from './headerNav'

describe('accountMenuRoutes', () => {
  it('lists Tags and Search for everyone, and Company Settings only for admin and owner', () => {
    expect(accountMenuRoutes('viewer')).toEqual(['tags', 'search'])
    expect(accountMenuRoutes('user')).toEqual(['tags', 'search'])
    expect(accountMenuRoutes('admin')).toEqual(['tags', 'search', 'company-settings'])
    expect(accountMenuRoutes('owner')).toEqual(['tags', 'search', 'company-settings'])
  })

  it('gives the common two before the role is known', () => {
    expect(accountMenuRoutes(null)).toEqual(['tags', 'search'])
  })
})

describe('canOfferUpload', () => {
  it('offers Upload to user and above, never to a viewer or before the role is known', () => {
    expect(canOfferUpload('owner')).toBe(true)
    expect(canOfferUpload('admin')).toBe(true)
    expect(canOfferUpload('user')).toBe(true)
    expect(canOfferUpload('viewer')).toBe(false)
    expect(canOfferUpload(null)).toBe(false)
  })
})
