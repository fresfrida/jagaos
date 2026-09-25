import { describe, expect, it } from 'vitest'
import { REJECTED_STATUS, documentsForCalendar, isRejectedDocument } from './documentStatus'

describe('documentStatus (DECISIONS #109)', () => {
  it('a rejected document is recognised, and nothing else is', () => {
    expect(REJECTED_STATUS).toBe('rejected')
    expect(isRejectedDocument({ status: 'rejected' })).toBe(true)
    for (const status of ['filed', 'needs_review', 'quarantined', 'purge_requested', 'archived', 'processed']) expect(isRejectedDocument({ status }), status).toBe(false)
  })

  it('the Calendar leaves rejected documents out and keeps the order of the rest', () => {
    const docs = [{ id: 1, status: 'filed' }, { id: 2, status: 'rejected' }, { id: 3, status: 'needs_review' }, { id: 4, status: 'rejected' }]
    expect(documentsForCalendar(docs).map((d) => d.id)).toEqual([1, 3])
    expect(documentsForCalendar([])).toEqual([])
  })
})
