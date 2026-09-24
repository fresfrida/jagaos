import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { opsApi } from './opsApi'

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ document_id: 1, status: 'needs_review' }), { status: 200 }))
})
afterEach(() => fetchSpy.mockRestore())

const urlOfCall = () => String(fetchSpy.mock.calls[0]![0])
const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })

describe('upload calls carry the checklist hint (round 16)', () => {
  it('uploadDocument adds doc_type_hint only when given one', async () => {
    await opsApi.uploadDocument(file, false, 'en', 'constitution')
    expect(new URL(urlOfCall()).searchParams.get('doc_type_hint')).toBe('constitution')
    expect(new URL(urlOfCall()).searchParams.get('is_picture')).toBe('false')
  })

  it.each([undefined, null, ''])('uploadDocument sends no hint parameter for %j', async (hint) => {
    await opsApi.uploadDocument(file, false, 'en', hint)
    expect(new URL(urlOfCall()).searchParams.has('doc_type_hint')).toBe(false)
  })

  it('uploadPages adds it too, and the language still goes', async () => {
    await opsApi.uploadPages([file, file], 'ms', 'agm_minutes')
    const params = new URL(urlOfCall()).searchParams
    expect(params.get('doc_type_hint')).toBe('agm_minutes')
    expect(params.get('language')).toBe('ms')
  })

  it('uploadPages without one sends only the language', async () => {
    await opsApi.uploadPages([file, file], 'en')
    expect([...new URL(urlOfCall()).searchParams.keys()]).toEqual(['language'])
  })
})
