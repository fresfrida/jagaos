/** The dates on a Company Files card (round 7, S1e, DECISIONS #138): "Upload date" (the company's day) and "Document date", or "Picture date" for a picture
 * (its date-taken, or its upload day when none was ever known). Same rule as the Calendar and the range filter (documentDates.ts). */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { DocumentCard } from './DocumentCard'
import type { DocumentRow } from './opsApi'

vi.mock('./opsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./opsApi')>()
  return { ...actual, opsApi: { ...actual.opsApi, fetchDocumentThumbnail: vi.fn(() => new Promise(() => undefined)), fetchDocumentFile: vi.fn(() => new Promise(() => undefined)) } }
})

const base: DocumentRow = {
  id: 7, filename: 'photo.jpg', media_type: 'image/jpeg', lane: 'memory', doc_type: 'photo', status: 'filed', received_at: '2026-09-23 06:14:00',
  description: null, bucket: 'Memory Lane', vendor_name: null, occurred_on: null, can_edit: true,
}
const show = (over: Partial<DocumentRow>) => render(<DocumentCard doc={{ ...base, ...over }} canEdit canArchive onView={vi.fn()} onArchive={vi.fn()} onSaved={vi.fn()} />)
const dates = () => screen.getByTestId('document-dates').textContent

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

describe('a picture card', () => {
  it('with a date-taken says "Picture date" and shows THAT date, beside the upload date', () => {
    show({ occurred_on: '2019-08-08' })
    expect(dates()).toBe('Upload date: 23 Sept 2026 · Picture date: 8 Aug 2019')
  })

  it('with no date-taken says "Picture date" and shows its UPLOAD day (the fallback), never "No document date"', () => {
    show({ occurred_on: null })
    expect(dates()).toBe('Upload date: 23 Sept 2026 · Picture date: 23 Sept 2026')
    expect(document.body.textContent).not.toContain('No document date')
  })

  it('never says "Document date"', () => {
    show({ occurred_on: '2019-08-08' })
    expect(dates()).not.toContain('Document date')
  })
})

describe('a document card is unchanged', () => {
  it('shows "Document date" with its own date', () => {
    show({ lane: 'invoice', media_type: 'application/pdf', filename: 'inv.pdf', occurred_on: '2026-09-12' })
    expect(dates()).toBe('Upload date: 23 Sept 2026 · Document date: 12 Sept 2026')
  })

  it('with no date still says "No document date", and is not treated as a picture', () => {
    show({ lane: 'invoice', media_type: 'application/pdf', filename: 'inv.pdf', occurred_on: null })
    expect(dates()).toBe('Upload date: 23 Sept 2026 · Document date: No document date')
    expect(dates()).not.toContain('Picture date')
  })
})

describe('the upload day is the COMPANY\'s day, from the same function as the Calendar and the filter', () => {
  it('a file uploaded at 20:30 UTC on the 23rd is the 24th for a Singapore company (it used to show the UTC day)', () => {
    show({ received_at: '2026-09-23 20:30:00', occurred_on: '2019-08-08' })
    expect(dates()).toBe('Upload date: 24 Sept 2026 · Picture date: 8 Aug 2019')
  })

  it('and the picture fallback moves with it', () => {
    show({ received_at: '2026-09-23 20:30:00', occurred_on: null })
    expect(dates()).toBe('Upload date: 24 Sept 2026 · Picture date: 24 Sept 2026')
  })
})

describe('the label in every language', () => {
  it.each([['ms', 'Tarikh gambar'], ['zh', '照片日期'], ['ta', 'படத்தின் தேதி']])('%s says %s', async (lang, label) => {
    await i18n.changeLanguage(lang)
    show({ occurred_on: '2019-08-08' })
    expect(dates()).toContain(label)
    expect(dates()).not.toMatch(/ops\.dates|undefined|null/)
  })
})
