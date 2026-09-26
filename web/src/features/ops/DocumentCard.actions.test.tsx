/** The row of text actions on a document card (DECISIONS #108): still text, but real tap targets, evenly spaced. Purge was a fourth action
 * set apart from the rest until DECISIONS #109 folded it into Delete's confirmation, so the row is View, Edit and Delete, with the History
 * accordion (round 5 as the AI trace, DECISIONS #125; round 6 swapped its content, DECISIONS #129) as its own always-visible block below, no longer an overflow menu at the row's far end.
 * jsdom has no layout, so this pins what makes it true; the measured widths, and the Malay row, are checked in a real browser. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { DocumentCard } from './DocumentCard'
import type { DocumentRow } from './opsApi'

const doc: DocumentRow = {
  id: 7, filename: 'lease.txt', media_type: 'text/plain', lane: 'important', doc_type: 'lease', status: 'filed', received_at: '2026-09-24 05:00:00',
  description: JSON.stringify({ en: 'Office lease' }), bucket: 'Contracts', vendor_name: null, occurred_on: null, can_edit: true,
}
const show = (over: Partial<{ canRequestPurge: boolean; canArchive: boolean; canEdit: boolean }> = {}) =>
  render(<DocumentCard doc={doc} canEdit canArchive canRequestPurge onView={vi.fn()} onArchive={vi.fn()} onRequestPurge={vi.fn()} onCancelPurge={vi.fn()} onSaved={vi.fn()} {...over} />)
const action = (name: RegExp) => screen.getByRole('button', { name })

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

describe('document card actions: tap targets', () => {
  it('View, Edit and Delete are each at least 44px tall, with padding either side, and never wrap their label', () => {
    show()
    for (const name of [/^view$/i, /^edit$/i, /^delete$/i]) {
      const cls = action(name).className
      expect(cls, String(name)).toContain('min-h-[44px]')
      expect(cls, String(name)).toContain('px-2')
      expect(cls, String(name)).toContain('whitespace-nowrap')
    }
  })

  it('they are still text actions: no border, no fill, the same small mono label as before', () => {
    show()
    for (const name of [/^view$/i, /^edit$/i, /^delete$/i]) {
      const cls = action(name).className
      expect(cls).toContain('font-mono')
      expect(cls).toContain('uppercase')
      expect(cls).toContain('text-[13px]')
      expect(cls).not.toMatch(/\bborder\b|\bbg-/)
    }
  })

  it('the History accordion trigger is its own full-width row, separate from View/Edit/Delete', () => {
    show()
    const trigger = screen.getByRole('button', { name: /^history/i })
    expect(trigger.className).toContain('w-full')
    expect(action(/^view$/i).parentElement).not.toBe(trigger.parentElement)
  })
})

describe('document card actions: one destructive action (DECISIONS #109)', () => {
  it('there is Delete and no Purge, even for a caller allowed to request one', () => {
    show()
    expect(action(/^delete$/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^purge$/i })).toBeNull()
  })

  it('View, Edit and Delete all share one group', () => {
    show()
    const group = (name: RegExp) => action(name).parentElement!
    expect(group(/^view$/i)).toBe(group(/^edit$/i))
    expect(group(/^view$/i)).toBe(group(/^delete$/i))
  })

  it('reads in Malay: Padam is the one destructive action and nowrap', async () => {
    await i18n.changeLanguage('ms')
    show()
    expect(screen.queryByRole('button', { name: /hapus kekal/i })).toBeNull()
    expect(screen.getByRole('button', { name: /^padam$/i }).className).toContain('whitespace-nowrap')
  })
})

describe('the Delete confirmation carries the owner\'s permanent-removal choice (DECISIONS #109)', () => {
  const openDelete = () => { fireEvent.click(action(/^delete$/i)); return screen.getByRole('alertdialog') }

  it('an owner (canRequestPurge) sees the checkbox in the same dialog; without that permission there is none', () => {
    show()
    expect(within(openDelete()).getByRole('checkbox', { name: 'Also remove it permanently' })).toBeTruthy()
    cleanup()
    show({ canRequestPurge: false })
    expect(within(openDelete()).queryByRole('checkbox')).toBeNull()
  })

  it('a document already waiting to be purged keeps Delete visible, DISABLED, rather than gone (round 5, item 2, DECISIONS #125)', () => {
    render(<DocumentCard doc={{ ...doc, status: 'purge_requested' }} canEdit canArchive canRequestPurge onView={vi.fn()} onArchive={vi.fn()} onRequestPurge={vi.fn()} onCancelPurge={vi.fn()} onSaved={vi.fn()} />)
    const deleteButton = screen.getByRole('button', { name: /^delete$/i })
    expect(deleteButton.hasAttribute('disabled')).toBe(true)
    fireEvent.click(deleteButton) // disabled: must not open the confirmation dialog
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('confirming with the box ticked calls onRequestPurge only; unticked calls onArchive only', () => {
    const onArchive = vi.fn()
    const onRequestPurge = vi.fn()
    render(<DocumentCard doc={doc} canEdit canArchive canRequestPurge onView={vi.fn()} onArchive={onArchive} onRequestPurge={onRequestPurge} onSaved={vi.fn()} />)

    let dialog = openDelete()
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Purge' }))
    expect(onRequestPurge).toHaveBeenCalledTimes(1)
    expect(onArchive).not.toHaveBeenCalled()

    dialog = openDelete()
    expect((within(dialog).getByRole('checkbox') as HTMLInputElement).checked).toBe(false) // it starts unticked every time
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(onRequestPurge).toHaveBeenCalledTimes(1)
  })

  it('reads in Malay, Chinese and Tamil', async () => {
    for (const [language, label] of [['ms', 'Juga hapus kekal'], ['zh', '同时彻底清除'], ['ta', 'நிரந்தரமாகவும் நீக்கு']] as const) {
      await i18n.changeLanguage(language)
      show()
      fireEvent.click(screen.getAllByRole('button')[2]!) // the third text action is Delete in every language
      expect(within(screen.getByRole('alertdialog')).getByRole('checkbox', { name: label })).toBeTruthy()
      cleanup()
    }
  })
})

describe('a rejected document (a legacy state) still gets a real title (DECISIONS #109)', () => {
  const rejected = (over: Partial<DocumentRow> = {}): DocumentRow => ({ ...doc, status: 'rejected', description: null, lane: null, doc_type: null, bucket: null, filename: 'old-upload-scan.pdf', ...over })

  it('says it is a rejected document and shows the file name under it, instead of a blank or "- / -" card', () => {
    render(<DocumentCard doc={rejected()} canEdit canArchive canRequestPurge={false} onView={vi.fn()} onArchive={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('Rejected document')).toBeTruthy()
    expect(screen.getByText('old-upload-scan.pdf')).toBeTruthy()
    expect(screen.queryByText('- / -')).toBeNull()
  })

  it('a rejected document that DOES have a description keeps it as the title', () => {
    render(<DocumentCard doc={rejected({ description: JSON.stringify({ en: 'Office lease' }) })} canEdit canArchive canRequestPurge={false} onView={vi.fn()} onArchive={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('Office lease')).toBeTruthy()
    expect(screen.queryByText('Rejected document')).toBeNull()
  })

  it('reads in the other languages', async () => {
    for (const [language, title] of [['zh', '已拒绝的文件'], ['ms', 'Dokumen ditolak'], ['ta', 'நிராகரிக்கப்பட்ட ஆவணம்']] as const) {
      await i18n.changeLanguage(language)
      render(<DocumentCard doc={rejected()} canEdit canArchive canRequestPurge={false} onView={vi.fn()} onArchive={vi.fn()} onSaved={vi.fn()} />)
      expect(screen.getByText(title)).toBeTruthy()
      cleanup()
    }
  })

  it('an ordinary document with no description, lane or type at all shows its file name, never "- / -"', () => {
    render(<DocumentCard doc={{ ...doc, status: 'filed', description: null, lane: null, doc_type: null, filename: 'mystery.pdf' }} canEdit canArchive canRequestPurge={false} onView={vi.fn()} onArchive={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('mystery.pdf')).toBeTruthy()
    expect(screen.queryByText('- / -')).toBeNull()
  })
})
