/** A document the owner asked to have purged, still shown to them until the team removes it (round 21, DECISIONS #102): the card is
 * read-only whatever the caller's permissions say, so it cannot be edited, deleted or asked for again. */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { DocumentCard } from './DocumentCard'
import type { DocumentRow } from './opsApi'

const doc = (status: string): DocumentRow => ({
  id: 7, filename: 'lease.txt', media_type: 'text/plain', lane: 'important', doc_type: 'lease', status, received_at: '2026-09-24 05:00:00',
  description: JSON.stringify({ en: 'Office lease' }), bucket: 'Contracts', vendor_name: null, occurred_on: null, can_edit: true,
})

const show = (status: string) =>
  render(<DocumentCard doc={doc(status)} canEdit canArchive canRequestPurge onView={vi.fn()} onTrace={vi.fn()} onArchive={vi.fn()} onRequestPurge={vi.fn()} onSaved={vi.fn()} />)

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

describe('DocumentCard for a purge the owner asked for', () => {
  it('is marked, explains what happens, and offers View only, even to a caller allowed to do everything', () => {
    show('purge_requested')
    expect(screen.getByText('Purge requested')).toBeTruthy()
    expect(screen.getByTestId('purge-pending-note').textContent).toBe('Purge requested: the team removes it permanently.')
    expect(screen.getByRole('button', { name: /^view$/i })).toBeTruthy()
    for (const name of [/^edit$/i, /^delete$/i, /^purge$/i, /more actions/i]) expect(screen.queryByRole('button', { name }), String(name)).toBeNull()
  })

  it('an ordinary filed document, by contrast, keeps every action and shows no such marker', () => {
    show('filed')
    expect(screen.queryByTestId('purge-pending-note')).toBeNull()
    for (const name of [/^view$/i, /^edit$/i, /^delete$/i, /more actions/i]) expect(screen.getByRole('button', { name }), String(name)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^purge$/i })).toBeNull() // permanent removal is a choice inside Delete's confirmation now (DECISIONS #109)
  })
})
