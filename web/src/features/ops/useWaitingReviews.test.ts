import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./opsApi', async (importActual) => ({
  ...(await importActual<typeof import('./opsApi')>()),
  opsApi: { listReviewItems: vi.fn() },
}))

import { opsApi, type ReviewItem } from './opsApi'
import { useWaitingReviews } from './useWaitingReviews'

const list = vi.mocked(opsApi.listReviewItems)
const item = (id: number, over: Partial<ReviewItem> = {}): ReviewItem => ({
  id, document_id: id, document_filename: `f${id}.pdf`, document_media_type: 'application/pdf', document_description: null,
  document_bucket: null, document_lane: 'invoice', document_doc_type: 'invoice', document_vendor_name: null,
  thread_id: `t${id}`, reason: 'clean', question: '[]', proposed_json: '{}', status: 'open', ...over,
})

beforeEach(() => { vi.resetAllMocks() })

describe('useWaitingReviews', () => {
  it('starts at zero and fetches the queue once for a signed-in role', async () => {
    list.mockResolvedValue([item(1), item(2)])
    const { result } = renderHook(() => useWaitingReviews('admin'))
    expect(result.current).toEqual({ mine: 0, total: 0 })

    await waitFor(() => expect(result.current).toEqual({ mine: 2, total: 2 }))
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('does not fetch before there is a role', () => {
    renderHook(() => useWaitingReviews(null))
    expect(list).not.toHaveBeenCalled()
  })

  it('counts as "mine" what the server says the caller can resolve, and the rest only in the total', async () => {
    list.mockResolvedValue([item(1, { can_resolve: true }), item(2, { can_resolve: false }), item(3, { can_resolve: false })])
    const { result } = renderHook(() => useWaitingReviews('user'))
    await waitFor(() => expect(result.current).toEqual({ mine: 1, total: 3 }))
  })

  it('without a per-item answer (an older backend) falls back to the role: admin and owner resolve, a user does not', async () => {
    list.mockResolvedValue([item(1), item(2)])
    const admin = renderHook(() => useWaitingReviews('admin'))
    const user = renderHook(() => useWaitingReviews('user'))
    await waitFor(() => expect(admin.result.current.mine).toBe(2))
    await waitFor(() => expect(user.result.current).toEqual({ mine: 0, total: 2 }))
  })

  it('never counts the person\'s own PRIVATE files: they do not surface on the home', async () => {
    list.mockResolvedValue([
      item(1, { can_resolve: true, document_visibility: 'company' }),
      item(2, { can_resolve: true, document_visibility: 'only_me' }),
      item(3, { can_resolve: true, document_visibility: 'only_me' }),
    ])
    const { result } = renderHook(() => useWaitingReviews('user'))
    await waitFor(() => expect(result.current).toEqual({ mine: 1, total: 1 }))
  })

  it('a queue holding only private files counts as nothing', async () => {
    list.mockResolvedValue([item(1, { can_resolve: true, document_visibility: 'only_me' })])
    const { result } = renderHook(() => useWaitingReviews('owner'))
    await waitFor(() => expect(list).toHaveBeenCalled())
    await Promise.resolve()
    expect(result.current).toEqual({ mine: 0, total: 0 })
  })

  it('a failed fetch is zero, not an error', async () => {
    list.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useWaitingReviews('owner'))
    await waitFor(() => expect(list).toHaveBeenCalled())
    await Promise.resolve()
    expect(result.current).toEqual({ mine: 0, total: 0 })
  })

  it('ignores an answer that arrives after the page is gone', async () => {
    let finish: (items: ReviewItem[]) => void = () => undefined
    list.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { result, unmount } = renderHook(() => useWaitingReviews('owner'))
    unmount()
    finish([item(1)])
    await Promise.resolve()
    expect(result.current).toEqual({ mine: 0, total: 0 })
  })
})
