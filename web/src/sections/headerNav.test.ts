import { describe, expect, it } from 'vitest'
import { LG_ONLY_NAV_ROUTES, accountMenuRoutes, canOfferUpload, canUsePrivateSpace, narrowWidthMenuRoutes, signedInNavRoutes } from './headerNav'

describe('signedInNavRoutes (DECISIONS #106)', () => {
  it('is Calendar, Search and Company Files for a viewer, and Only me as well from user up, in that order', () => {
    expect(signedInNavRoutes('viewer')).toEqual(['calendar', 'search', 'company-files'])
    for (const role of ['user', 'admin', 'owner'] as const) {
      expect(signedInNavRoutes(role)).toEqual(['calendar', 'search', 'company-files', 'only-me'])
    }
  })

  it('has no Tags anywhere, and gives the common three before the role is known', () => {
    expect(signedInNavRoutes(null)).toEqual(['calendar', 'search', 'company-files'])
    for (const role of [null, 'viewer', 'user', 'admin', 'owner'] as const) expect(signedInNavRoutes(role)).not.toContain('tags' as never)
  })
})

describe('accountMenuRoutes', () => {
  it('lists Company Settings for admin and owner and nothing for anyone else: the rest moved into the header', () => {
    expect(accountMenuRoutes('viewer')).toEqual([])
    expect(accountMenuRoutes('user')).toEqual([])
    expect(accountMenuRoutes('admin')).toEqual(['company-settings'])
    expect(accountMenuRoutes('owner')).toEqual(['company-settings'])
    expect(accountMenuRoutes(null)).toEqual([])
  })
})

describe('canUsePrivateSpace', () => {
  it('is user and above: a viewer cannot upload, so a private space has nothing for them', () => {
    expect(canUsePrivateSpace('owner')).toBe(true)
    expect(canUsePrivateSpace('admin')).toBe(true)
    expect(canUsePrivateSpace('user')).toBe(true)
    expect(canUsePrivateSpace('viewer')).toBe(false)
    expect(canUsePrivateSpace(null)).toBe(false)
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

describe('the width tiers (DECISIONS #106)', () => {
  it('Search and Only me are the inline items that only fit from lg', () => {
    expect(LG_ONLY_NAV_ROUTES).toEqual(['search', 'only-me'])
  })

  it('between sm and lg they are in the account menu instead, for exactly the roles that see them inline', () => {
    expect(narrowWidthMenuRoutes('owner')).toEqual(['search', 'only-me'])
    expect(narrowWidthMenuRoutes('user')).toEqual(['search', 'only-me'])
    expect(narrowWidthMenuRoutes('viewer')).toEqual(['search'])
    expect(narrowWidthMenuRoutes(null)).toEqual(['search'])
  })
})
