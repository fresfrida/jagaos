import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../router/navigate', () => ({ navigate: vi.fn() }))

import { navigate } from '../../router/navigate'
import { handOffSelection, onSelectionHandedOff, takePendingSelection, type UploadSelection } from './pendingSelection'

const photo: UploadSelection = { kind: 'photo', file: new File(['x'], 'p.jpg', { type: 'image/jpeg' }) }
const doc: UploadSelection = { kind: 'document', files: [new File(['y'], 'd.pdf', { type: 'application/pdf' })] }

afterEach(() => {
  takePendingSelection()
  vi.clearAllMocks()
})

describe('pendingSelection', () => {
  it('parks a selection for exactly one reader', () => {
    handOffSelection(doc)
    expect(takePendingSelection()).toBe(doc)
    expect(takePendingSelection()).toBeNull()
  })

  it('sends the person to the Upload page', () => {
    handOffSelection(photo)
    expect(navigate).toHaveBeenCalledWith('/upload')
  })

  it('tells a page that is already open, so it can take the selection at once', () => {
    const seen: (UploadSelection | null)[] = []
    const off = onSelectionHandedOff(() => seen.push(takePendingSelection()))

    handOffSelection(photo)

    expect(seen).toEqual([photo])
    off()
  })

  it('stops telling a page that unsubscribed', () => {
    const handler = vi.fn()
    onSelectionHandedOff(handler)()
    handOffSelection(doc)
    expect(handler).not.toHaveBeenCalled()
  })

  it('a later selection replaces an untaken earlier one rather than queueing', () => {
    handOffSelection(photo)
    handOffSelection(doc)
    expect(takePendingSelection()).toBe(doc)
    expect(takePendingSelection()).toBeNull()
  })
})
