import { describe, expect, it } from 'vitest'
import { HOME_TITLE, pageTitle } from './routes'

describe('pageTitle', () => {
  it('is always "JagaOS: PageName", never "PageName - JagaOS"', () => {
    expect(pageTitle('calendar')).toBe('JagaOS: Calendar')
    expect(pageTitle('upload')).toBe('JagaOS: Upload')
    expect(pageTitle('company-files')).toBe('JagaOS: Company Files')
    expect(pageTitle('search')).toBe('JagaOS: Search')
    expect(pageTitle('company-settings')).toBe('JagaOS: Company Settings')
    expect(pageTitle('login')).toBe('JagaOS: Log in')
  })

  it('has exactly the asked-for home title, not derived from a route', () => {
    expect(pageTitle('home')).toBe('JagaOS, a Show Me Your Agents project')
    expect(HOME_TITLE).toBe('JagaOS, a Show Me Your Agents project')
  })

  it('uses the same shape for a page that does not exist', () => {
    expect(pageTitle('not-found')).toBe('JagaOS: Page not found')
  })

  it('never contains a dash or a hyphen separator', () => {
    for (const route of ['calendar', 'tags', 'stack', 'how-it-works', 'get-started', 'ops', 'upload'] as const) {
      expect(pageTitle(route)).not.toMatch(/ [-—] /)
    }
  })
})
