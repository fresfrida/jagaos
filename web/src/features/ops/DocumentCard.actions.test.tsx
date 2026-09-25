/** The row of text actions on a document card (DECISIONS #108): still text, but real tap targets, evenly spaced. Purge was a fourth action
 * set apart from the rest until DECISIONS #109 folded it into Delete's confirmation, so the row is View, Edit, Delete and the overflow menu.
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
  render(<DocumentCard doc={doc} canEdit canArchive canRequestPurge onView={vi.fn()} onTrace={vi.fn()} onArchive={vi.fn()} onRequestPurge={vi.fn()} onSaved={vi.fn()} {...over} />)
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

  it('the overflow menu button is a 44px target too, not 24px', () => {
    show()
    expect(action(/more actions/i).className).toContain('h-11')
    expect(action(/more actions/i).className).toContain('w-11')
  })
})

describe('document card actions: one destructive action (DECISIONS #109)', () => {
  it('there is Delete and no Purge, even for a caller allowed to request one', () => {
    show()
    expect(action(/^delete$/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^purge$/i })).toBeNull()
  })

  it('View, Edit and Delete share one group and the overflow menu is the far group, on its own line where there is no room', () => {
    show()
    const group = (name: RegExp) => action(name).parentElement!
    expect(group(/^view$/i)).toBe(group(/^edit$/i))
    expect(group(/^view$/i)).toBe(group(/^delete$/i))
    const far = action(/more actions/i).parentElement!.parentElement!
    expect(far).not.toBe(group(/^view$/i))
    expect(far.className).toContain('ml-auto')
    expect(far.parentElement).toBe(group(/^view$/i).parentElement)
    expect(far.parentElement!.className).toContain('flex-wrap')
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

  it('a document already waiting to be purged has no Delete, so no such choice', () => {
    render(<DocumentCard doc={{ ...doc, status: 'purge_requested' }} canEdit canArchive canRequestPurge onView={vi.fn()} onTrace={vi.fn()} onArchive={vi.fn()} onRequestPurge={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /^delete$/i })).toBeNull()
  })

  it('confirming with the box ticked calls onRequestPurge only; unticked calls onArchive only', () => {
    const onArchive = vi.fn()
    const onRequestPurge = vi.fn()
    render(<DocumentCard doc={doc} canEdit canArchive canRequestPurge onView={vi.fn()} onTrace={vi.fn()} onArchive={onArchive} onRequestPurge={onRequestPurge} onSaved={vi.fn()} />)

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
    render(<DocumentCard doc={rejected()} canEdit canArchive canRequestPurge={false} onView={vi.fn()} onTrace={vi.fn()} onArchive={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('Rejected document')).toBeTruthy()
    expect(screen.getByText('old-upload-scan.pdf')).toBeTruthy()
    expect(screen.queryByText('- / -')).toBeNull()
  })

  it('a rejected document that DOES have a description keeps it as the title', () => {
    render(<DocumentCard doc={rejected({ description: JSON.stringify({ en: 'Office lease' }) })} canEdit canArchive canRequestPurge={false} onView={vi.fn()} onTrace={vi.fn()} onArchive={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('Office lease')).toBeTruthy()
    expect(screen.queryByText('Rejected document')).toBeNull()
  })

  it('reads in the other languages', async () => {
    for (const [language, title] of [['zh', '已拒绝的文件'], ['ms', 'Dokumen ditolak'], ['ta', 'நிராகரிக்கப்பட்ட ஆவணம்']] as const) {
      await i18n.changeLanguage(language)
      render(<DocumentCard doc={rejected()} canEdit canArchive canRequestPurge={false} onView={vi.fn()} onTrace={vi.fn()} onArchive={vi.fn()} onSaved={vi.fn()} />)
      expect(screen.getByText(title)).toBeTruthy()
      cleanup()
    }
  })

  it('an ordinary document with no description, lane or type at all shows its file name, never "- / -"', () => {
    render(<DocumentCard doc={{ ...doc, status: 'filed', description: null, lane: null, doc_type: null, filename: 'mystery.pdf' }} canEdit canArchive canRequestPurge={false} onView={vi.fn()} onTrace={vi.fn()} onArchive={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByText('mystery.pdf')).toBeTruthy()
    expect(screen.queryByText('- / -')).toBeNull()
  })
})

describe('the Trace menu entry is called "AI trace" (DECISIONS #110)', () => {
  const openMenu = () => fireEvent.click(action(/more actions/i))

  it('the overflow menu offers "AI trace", not "Trace", and choosing it asks for the trace', () => {
    const onTrace = vi.fn()
    render(<DocumentCard doc={doc} canEdit canArchive canRequestPurge onView={vi.fn()} onTrace={onTrace} onArchive={vi.fn()} onRequestPurge={vi.fn()} onSaved={vi.fn()} />)
    openMenu()
    expect(screen.queryByRole('menuitem', { name: 'Trace' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'AI trace' }))
    expect(onTrace).toHaveBeenCalledTimes(1)
  })

  it.each([['zh', 'AI 追踪'], ['ms', 'Jejak AI'], ['ta', 'AI தடமறிதல்']])('is called %s in that language', async (language, label) => {
    await i18n.changeLanguage(language)
    show()
    fireEvent.click(screen.getAllByRole('button').find((b) => b.getAttribute('aria-haspopup') === 'menu')!)
    expect(screen.getByRole('menuitem', { name: label })).toBeTruthy()
  })
})

