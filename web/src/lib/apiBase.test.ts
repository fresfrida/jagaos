/** Where the browser sends API calls (DECISIONS #119): unset is the local default, a URL is that API, and an EMPTY value is the page's own
 * origin, so one build works from any hostname that reaches the API's Caddy. It was `||`, which read empty as "missing". */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_API_BASE_URL, resolveApiBase } from './apiClient'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('resolveApiBase', () => {
  it('not set is the local development address', () => {
    expect(resolveApiBase(undefined)).toBe('http://127.0.0.1:8000')
    expect(DEFAULT_API_BASE_URL).toBe('http://127.0.0.1:8000')
  })

  it('a URL is used as it is', () => {
    expect(resolveApiBase('https://13-251-52-222.nip.io')).toBe('https://13-251-52-222.nip.io')
  })

  it('EMPTY stays empty, meaning the page\'s own origin: it is not the same as unset', () => {
    expect(resolveApiBase('')).toBe('')
    expect(resolveApiBase('')).not.toBe(resolveApiBase(undefined))
  })
})

/** The wiring: the constant is read once, at import time, from the build's environment, and every call is `base + path`. */
async function callWith(env: string | undefined): Promise<{ base: string; requested: string }> {
  vi.resetModules()
  if (env === undefined) vi.stubEnv('VITE_API_BASE_URL', undefined as unknown as string)
  else vi.stubEnv('VITE_API_BASE_URL', env)
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
  const client = await import('./apiClient')
  await client.apiRequest('/api/health')
  return { base: client.API_BASE_URL, requested: String(fetchSpy.mock.calls[0]![0]) }
}

describe('the build environment reaches the requests', () => {
  it('EMPTY: the request is RELATIVE, /api/health, so the browser sends it to whatever origin the page came from', async () => {
    const { base, requested } = await callWith('')
    expect(base).toBe('')
    expect(requested).toBe('/api/health')
  })

  it('a URL: the request goes to that API', async () => {
    const { requested } = await callWith('https://api.example.test')
    expect(requested).toBe('https://api.example.test/api/health')
  })

  it('unset: the local development address', async () => {
    const { requested } = await callWith(undefined)
    expect(requested).toBe('http://127.0.0.1:8000/api/health')
  })
})
