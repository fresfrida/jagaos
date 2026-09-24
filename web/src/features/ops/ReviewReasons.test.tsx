/** How a review card's flagged reasons read (2026-09-24, round 11): a
 * Malay/Chinese/Tamil card must not carry English fragments, two signals
 * for the same problem must show once, and genuinely different problems
 * must stack as a list rather than one semicolon-joined run-on.
 */

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import type { ReviewReason } from './opsApi'
import { BUCKETS } from './opsApi'
import { bucketLabel, dedupeReasons, documentIsEditable, reasonDisplay } from './opsShared'
import { ReviewReasons } from './ReviewReasons'

const UNREADABLE_PHRASE = 'image with no clear readable text'

const couldNotRead: ReviewReason = { code: 'could_not_read_document', params: {} }
const signalsProblem: ReviewReason = { code: 'description_signals_problem', params: { word: UNREADABLE_PHRASE } }
const taxMismatch: ReviewReason = { code: 'gst_mismatch', params: { gst: '7.00', subtotal: '100.00', expectedGst: '9.00' } }
const missingFields: ReviewReason = { code: 'missing_required_fields', params: { fields: 'vendor, issued_on' } }

const switchLanguage = (code: string) => act(async () => { await i18n.changeLanguage(code) })
const tFor = (code: string) => i18n.getFixedT(code)

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

describe('two signals for the same problem', () => {
  it('collapses into the plainer one', () => {
    expect(dedupeReasons([couldNotRead, signalsProblem])).toEqual([couldNotRead])
    expect(dedupeReasons([signalsProblem, couldNotRead])).toEqual([couldNotRead])
  })

  it('keeps the technical one when it fires alone', () => {
    expect(dedupeReasons([signalsProblem])).toEqual([signalsProblem])
  })

  it('shows one bare sentence, not a "Please confirm:" fragment or a list', () => {
    const { container } = render(<ReviewReasons reasons={[couldNotRead, signalsProblem]} className="x" />)

    expect(container.querySelectorAll('p')).toHaveLength(1)
    expect(container.querySelector('ul')).toBeNull()
    expect(container.textContent).toBe(tFor('en')('ops.review.reasons.couldNotReadDocument'))
  })
})

describe('distinct reasons', () => {
  it('stack as a list under one heading instead of a semicolon-joined sentence', () => {
    const { container } = render(<ReviewReasons reasons={[taxMismatch, missingFields]} className="x" />)

    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.textContent).not.toContain(';')
    expect(container.querySelector('p')?.textContent).toBe('Please confirm:')
    // Bullets are sentences in their own right, so they start capitalised.
    expect(container.querySelectorAll('li')[0]?.textContent?.charAt(0)).toBe('G')
  })

  it('a single distinct reason still reads as one "Please confirm: …" sentence', () => {
    const display = reasonDisplay(tFor('en'), [taxMismatch])
    expect(display.layout).toBe('text')
  })
})

describe('no English fragments inside a translated sentence', () => {
  it.each(['ms', 'zh', 'ta'])('%s: the detector phrase and raw field names never appear', async (lang) => {
    await switchLanguage(lang)
    const t = tFor(lang)
    const { container } = render(
      <ReviewReasons
        reasons={[signalsProblem, missingFields, { code: 'extraction_error', params: { detail: 'extraction did not match schema: 1 validation error for InvoiceFields' } }]}
        className="x"
      />,
    )
    const text = container.textContent ?? ''

    expect(text).not.toContain(UNREADABLE_PHRASE)
    expect(text).not.toContain('validation error')
    expect(text).not.toContain('issued_on')
    // Field names come through translated, via the same table as the grid.
    expect(text).toContain(t('ops.review.fieldLabel.vendor'))
    expect(text).toContain(t('ops.review.fieldLabel.issuedOn'))
  })

  it('does not interpolate the matched word into the description warning', async () => {
    await switchLanguage('ms')
    const display = reasonDisplay(tFor('ms'), [signalsProblem])
    expect(display.layout === 'text' && display.text).not.toContain(UNREADABLE_PHRASE)
  })
})

describe('existing standalone headlines are untouched', () => {
  it('file missing and quarantined stay bare sentences', () => {
    const t = tFor('en')
    expect(reasonDisplay(t, [{ code: 'file_missing', params: {} }])).toEqual({
      layout: 'text', text: t('ops.review.reasons.fileMissing'),
    })
    expect(reasonDisplay(t, [{ code: 'injection_suspected_blocked', params: {} }])).toEqual({
      layout: 'text', text: t('ops.review.reasons.injectionSuspectedBlocked'),
    })
    expect(reasonDisplay(t, [])).toEqual({ layout: 'text', text: t('ops.review.reasons.clean') })
  })
})

describe('bucket labels', () => {
  it.each(['en', 'ms', 'zh', 'ta'])('%s: every bucket, including Contracts, has a translation', (lang) => {
    const t = tFor(lang)
    for (const bucket of BUCKETS) {
      const label = bucketLabel(t, bucket)
      expect(label, `${bucket} in ${lang}`).not.toMatch(/^ops\./)
      if (lang !== 'en') expect(label, `${bucket} in ${lang} is still English`).not.toBe(bucket)
    }
  })
})

describe('documentIsEditable (frontend deploys before the backend does)', () => {
  it('follows the server when it answers', () => {
    expect(documentIsEditable(true, { can_edit: true })).toBe(true)
    expect(documentIsEditable(true, { can_edit: false })).toBe(false)
  })

  it('never offers Edit to a role that cannot edit, whatever the server says', () => {
    expect(documentIsEditable(false, { can_edit: true })).toBe(false)
  })

  it('falls back to the role check against a backend that predates can_edit', () => {
    expect(documentIsEditable(true, {})).toBe(true)
    expect(documentIsEditable(false, {})).toBe(false)
  })
})
