import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { opsApi } from './opsApi'

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ document_id: 1, status: 'needs_review' }), { status: 200 }))
})
afterEach(() => fetchSpy.mockRestore())

const urlOfCall = () => String(fetchSpy.mock.calls[0]![0])
const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })

describe('upload calls carry the checklist hint (round 16)', () => {
  it('uploadDocument adds doc_type_hint only when given one', async () => {
    await opsApi.uploadDocument(file, false, 'en', { docTypeHint: 'constitution' })
    expect(new URL(urlOfCall()).searchParams.get('doc_type_hint')).toBe('constitution')
    expect(new URL(urlOfCall()).searchParams.get('is_picture')).toBe('false')
  })

  it.each([undefined, null, ''])('uploadDocument sends no hint parameter for %j', async (hint) => {
    await opsApi.uploadDocument(file, false, 'en', { docTypeHint: hint })
    expect(new URL(urlOfCall()).searchParams.has('doc_type_hint')).toBe(false)
  })

  it('uploadPages adds it too, and the language still goes', async () => {
    await opsApi.uploadPages([file, file], 'ms', { docTypeHint: 'agm_minutes' })
    const params = new URL(urlOfCall()).searchParams
    expect(params.get('doc_type_hint')).toBe('agm_minutes')
    expect(params.get('language')).toBe('ms')
  })

  it('uploadPages without one sends only the language', async () => {
    await opsApi.uploadPages([file, file], 'en')
    expect([...new URL(urlOfCall()).searchParams.keys()]).toEqual(['language'])
  })
})


describe('upload calls carry the visibility of the Only me section (round 19)', () => {
  it('uploadDocument sends visibility=only_me for a personal file and nothing for a company one', async () => {
    await opsApi.uploadDocument(file, false, 'en', { visibility: 'only_me' })
    expect(new URL(urlOfCall()).searchParams.get('visibility')).toBe('only_me')
    fetchSpy.mockClear()
    await opsApi.uploadDocument(file, false, 'en', { visibility: 'company' })
    expect(new URL(urlOfCall()).searchParams.has('visibility')).toBe(false)
    fetchSpy.mockClear()
    await opsApi.uploadDocument(file, false, 'en')
    expect(new URL(urlOfCall()).searchParams.has('visibility')).toBe(false)
  })

  it('uploadPages sends it too, together with a hint', async () => {
    await opsApi.uploadPages([file, file], 'en', { visibility: 'only_me', docTypeHint: 'agm_minutes' })
    const params = new URL(urlOfCall()).searchParams
    expect([params.get('visibility'), params.get('doc_type_hint')]).toEqual(['only_me', 'agm_minutes'])
  })

  it('listPersonalFiles asks the personal-files endpoint', async () => {
    fetchSpy.mockImplementationOnce(async () => new Response('[]', { status: 200 }))
    await opsApi.listPersonalFiles()
    expect(new URL(urlOfCall()).pathname).toBe('/api/personal-files')
  })
})
