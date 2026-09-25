import { describe, expect, it } from 'vitest'
import { FIT_VIEWPORT_ROUTES, HOME_TITLE, pageTitle, parsePath } from './routes'

describe('pageTitle', () => {
  it('is always "JagaOS: PageName", never "PageName - JagaOS"', () => {
    expect(pageTitle('calendar')).toBe('JagaOS: Calendar')
    expect(pageTitle('upload')).toBe('JagaOS: Upload')
    expect(pageTitle('company-files')).toBe('JagaOS: Company Files')
    expect(pageTitle('search')).toBe('JagaOS: Search')
    expect(pageTitle('company-settings')).toBe('JagaOS: Company Settings')
    expect(pageTitle('only-me')).toBe('JagaOS: Only me')
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
    for (const route of ['calendar', 'stack', 'how-it-works', 'ops', 'upload'] as const) {
      expect(pageTitle(route)).not.toMatch(/ [-—] /)
    }
  })
})

describe('removed routes (DECISIONS #106)', () => {
  it('/tags and /get-started no longer exist: the Tags page and the Get Started page are gone', () => {
    expect(parsePath('/tags')).toBe('not-found')
    expect(parsePath('/get-started')).toBe('not-found')
  })

  it('the app pages that remain still resolve', () => {
    for (const [path, id] of [['/calendar', 'calendar'], ['/company-files', 'company-files'], ['/search', 'search'], ['/only-me', 'only-me'], ['/login', 'login']] as const) {
      expect(parsePath(path)).toBe(id)
    }
  })
})

describe('the pages that fill the viewport (DECISIONS #109)', () => {
  it('is the signed-in home and only that', () => {
    expect(FIT_VIEWPORT_ROUTES).toEqual(['home'])
  })
})

