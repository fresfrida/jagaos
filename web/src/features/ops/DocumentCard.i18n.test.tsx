/** Regression tests for the Company Files card and the shared description
 * hook (2026-09-24, round 10): a document's description is stored per
 * language, so switching the UI language must change what the card shows
 * without any re-upload or re-fetch — and must never overwrite text the
 * user has typed into the edit form. */

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { ApiError } from '../../lib/apiClient'
import { DocumentCard } from './DocumentCard'
import { opsApi, type DocumentRow } from './opsApi'
import { useEditableDescription } from './useEditableDescription'

const EN = 'Invoice from Acme Engineering for consulting services, $396'
const MS = 'Invois daripada Acme Engineering untuk perkhidmatan perundingan, $396'
const BOTH = JSON.stringify({ en: EN, ms: MS })

const doc: DocumentRow = {
  id: 7,
  filename: 'acme.pdf',
  // A PDF: since round 20 its card asks the server for a first-page thumbnail once, when it mounts
  // (the tests below check that a language switch never asks again).
  media_type: 'application/pdf',
  lane: 'invoice',
  doc_type: 'invoice',
  status: 'filed',
  received_at: '2026-09-24 05:00:00',
  description: BOTH,
  bucket: 'Expenses',
  vendor_name: 'Acme Engineering',
  occurred_on: '2026-09-12',
  can_edit: true,
}

const renderCard = () =>
  render(<DocumentCard doc={doc} canEdit canArchive onView={vi.fn()} onArchive={vi.fn()} onSaved={vi.fn()} />)

const switchLanguage = (code: string) => act(async () => { await i18n.changeLanguage(code) })

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, { status: 404 }))
  await i18n.changeLanguage('en')
})

afterEach(() => {
  cleanup()
  fetchSpy.mockRestore()
})

describe('DocumentCard description follows the selected language', () => {
  it('re-renders the shown description on a language switch with no re-fetch', async () => {
    renderCard()
    expect(screen.getByText(EN)).toBeTruthy()
    const requestsAtMount = fetchSpy.mock.calls.length

    await switchLanguage('ms')

    expect(screen.getByText(MS)).toBeTruthy()
    expect(screen.queryByText(EN)).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(requestsAtMount)
  })

  it('falls back to English for a language the document has no text for', async () => {
    renderCard()
    await switchLanguage('ta')
    expect(screen.getByText(EN)).toBeTruthy()
  })

  it('never shows both languages at once', async () => {
    renderCard()
    for (const code of ['en', 'ms', 'zh']) {
      await switchLanguage(code)
      const shown = [EN, MS].filter((text) => screen.queryByText(text) !== null)
      expect(shown).toHaveLength(1)
    }
  })

  it('keeps an open, untouched edit field in step with the language', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByDisplayValue(EN)).toBeTruthy()

    await switchLanguage('ms')

    expect(screen.getByDisplayValue(MS)).toBeTruthy()
    expect(screen.queryByDisplayValue(EN)).toBeNull()
  })

  it('does not overwrite text the user typed when the language changes', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByDisplayValue(EN), { target: { value: 'My own correction' } })

    await switchLanguage('ms')

    expect(screen.getByDisplayValue('My own correction')).toBeTruthy()
  })

  it('starts each edit session from what is on screen, not from an earlier edit', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByDisplayValue(EN), { target: { value: 'Discarded draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await switchLanguage('ms')

    fireEvent.click(screen.getByRole('button', { name: i18n.t('ops.documents.edit') }))

    expect(screen.getByDisplayValue(MS)).toBeTruthy()
  })
})

describe('useEditableDescription (shared by DocumentCard and ReviewQueueCard)', () => {
  it('adopts a caption that lands late, until the user has typed something', () => {
    const { result, rerender } = renderHook(({ raw }) => useEditableDescription(raw), {
      initialProps: { raw: null as string | null },
    })
    expect(result.current.description).toBe('')

    rerender({ raw: JSON.stringify({ en: 'A caption' }) })
    expect(result.current.description).toBe('A caption')

    act(() => result.current.setDescription('Typed by the reviewer'))
    rerender({ raw: JSON.stringify({ en: 'A later caption' }) })
    expect(result.current.description).toBe('Typed by the reviewer')
  })

  it('leaves a field the user is typing in alone while the caption is still pending', () => {
    const { result } = renderHook(() => useEditableDescription(null))
    act(() => result.current.setDescription('Typing before the caption arrives'))
    expect(result.current.description).toBe('Typing before the caption arrives')
  })
})

describe('a refused save', () => {
  it('shows a translated permission message, not the server\'s English sentence', async () => {
    vi.spyOn(opsApi, 'editDocument').mockRejectedValue(new ApiError(403, 'You can only edit documents you uploaded yourself'))
    await switchLanguage('ms')
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('ops.documents.edit') }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('common.buttons.save') }))

    const message = i18n.t('ops.documents.editForbidden')
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy())
    expect(screen.queryByText(/You can only edit/)).toBeNull()
    vi.mocked(opsApi.editDocument).mockRestore()
  })
})
