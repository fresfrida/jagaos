import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiRequest } from './apiClient'

const respond = (status: number, body: string) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status, statusText: 'x' }))

afterEach(() => vi.restoreAllMocks())

describe('apiRequest errors', () => {
  it('a plain string detail is the message, as before', async () => {
    respond(400, JSON.stringify({ detail: 'nope' }))
    await expect(apiRequest('/x')).rejects.toMatchObject({ status: 400, message: 'nope', code: undefined })
  })

  it('a structured detail gives the message, the code and the rest of it (round 20)', async () => {
    respond(413, JSON.stringify({ detail: { code: 'file_too_large', limit_bytes: 26214400, message: 'That file is larger than the 25 MB limit.' } }))
    const error = await apiRequest('/x').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(413)
    expect((error as ApiError).message).toBe('That file is larger than the 25 MB limit.')
    expect((error as ApiError).code).toBe('file_too_large')
    expect((error as ApiError).data?.limit_bytes).toBe(26214400)
  })

  it('a structured detail with no message falls back to the status text, not "[object Object]"', async () => {
    respond(409, JSON.stringify({ detail: { code: 'x' } }))
    const error = (await apiRequest('/x').catch((e: unknown) => e)) as ApiError
    expect(error.code).toBe('x')
    expect(error.message).not.toContain('object')
  })

  it('a body that is not JSON is shown as it is', async () => {
    respond(502, 'Bad gateway')
    await expect(apiRequest('/x')).rejects.toMatchObject({ status: 502, message: 'Bad gateway' })
  })

  it('a successful response is its JSON', async () => {
    respond(200, JSON.stringify({ ok: true }))
    await expect(apiRequest('/x')).resolves.toEqual({ ok: true })
  })
})
