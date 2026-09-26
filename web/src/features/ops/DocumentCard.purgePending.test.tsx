/** A document the owner asked to have purged, still shown to them until the team removes it (round 21, DECISIONS #102).
 * Round 5, item 2 (DECISIONS #125): the card used to hide Edit, Delete and its whole "···" menu outright. Edit and
 * Delete now stay in their normal places, DISABLED, and the expandable panel below (round 6, DECISIONS #129: now "History",
 * formerly the AI trace) is always visible and never gated on this at all, so a pending document is never a dead end for it. */

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
  render(<DocumentCard doc={doc(status)} canEdit canArchive canRequestPurge onView={vi.fn()} onArchive={vi.fn()} onRequestPurge={vi.fn()} onCancelPurge={vi.fn()} onSaved={vi.fn()} />)

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

describe('DocumentCard for a purge the owner asked for', () => {
  it('is marked, explains what happens, offers View and Cancel purge live, and Edit/Delete disabled in place rather than gone', () => {
    show('purge_requested')
    expect(screen.getByText('Purge requested')).toBeTruthy()
    expect(screen.getByTestId('purge-pending-note').textContent).toBe('Purge requested: the team removes it permanently.')
    expect(screen.getByRole('button', { name: /^view$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /cancel purge/i })).toBeTruthy()
    const editButton = screen.getByRole('button', { name: /^edit$/i })
    const deleteButton = screen.getByRole('button', { name: /^delete$/i })
    expect(editButton.hasAttribute('disabled')).toBe(true)
    expect(deleteButton.hasAttribute('disabled')).toBe(true)
    expect(editButton.getAttribute('aria-disabled')).toBe('true')
    expect(deleteButton.getAttribute('aria-disabled')).toBe('true')
  })

  it('the History accordion trigger stays live even while pending: the real fix for the old menu-gated dead end', () => {
    show('purge_requested')
    const trigger = screen.getByRole('button', { name: /^history/i })
    expect(trigger.hasAttribute('disabled')).toBe(false)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('an ordinary filed document, by contrast, keeps Edit and Delete enabled and shows no purge marker', () => {
    show('filed')
    expect(screen.queryByTestId('purge-pending-note')).toBeNull()
    expect(screen.queryByRole('button', { name: /cancel purge/i })).toBeNull()
    for (const name of [/^view$/i, /^edit$/i, /^delete$/i]) {
      const button = screen.getByRole('button', { name })
      expect(button.hasAttribute('disabled'), String(name)).toBe(false)
    }
    expect(screen.queryByRole('button', { name: /^purge$/i })).toBeNull() // permanent removal is a choice inside Delete's confirmation now (DECISIONS #109)
  })
})
