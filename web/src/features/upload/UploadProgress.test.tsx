import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { NARRATION_KEYS, NARRATION_STEP_MS, UploadProgress, narrationIndex } from './UploadProgress'

describe('narrationIndex', () => {
  it('starts on the first line and advances one line per step', () => {
    expect(narrationIndex(0)).toBe(0)
    expect(narrationIndex(NARRATION_STEP_MS - 1)).toBe(0)
    expect(narrationIndex(NARRATION_STEP_MS)).toBe(1)
    expect(narrationIndex(NARRATION_STEP_MS * 2)).toBe(2)
  })

  it('holds on the last line however long the upload takes, it never loops back', () => {
    // one step past the last line, and several other lengths (a modulo would land back on line 0 for some of these)
    for (const steps of [NARRATION_KEYS.length, NARRATION_KEYS.length + 1, 51, 50, 500]) {
      expect(narrationIndex(NARRATION_STEP_MS * steps), `after ${steps} steps`).toBe(NARRATION_KEYS.length - 1)
    }
  })

  it('never goes negative for a clock that steps back', () => {
    expect(narrationIndex(-500)).toBe(0)
  })
})

describe('UploadProgress', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    await i18n.changeLanguage('en')
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('shows a spinner, the filename cut in the middle, and the first narration line', () => {
    render(<UploadProgress name="Supplier-Invoice-July-2026-Straits-Print-Supplies-final-signed-version.pdf" />)
    const visible = screen.getByTestId('upload-progress').querySelector('[title]')?.firstElementChild ?? null // FileName: the cut text
    expect(visible?.textContent).toContain('…')
    expect(visible?.textContent?.endsWith('.pdf')).toBe(true)
    expect(screen.getByTestId('upload-narration').textContent).toBe('Reading your document…')
    expect(screen.getByTestId('upload-progress').querySelector('.animate-spin')).not.toBeNull()
  })

  it('announces the upload once, with the whole name, for a screen reader', () => {
    render(<UploadProgress name="a-really-long-scanned-invoice-name-2026-09-24-final.pdf" />)
    expect(screen.getByRole('status').textContent).toContain('Uploading a-really-long-scanned-invoice-name-2026-09-24-final.pdf')
  })

  it('moves through the narration and stops on the last line', () => {
    render(<UploadProgress name="invoice.pdf" />)
    act(() => { vi.advanceTimersByTime(NARRATION_STEP_MS + 600) })
    expect(screen.getByTestId('upload-narration').textContent).toBe('Pulling out the details…')
    act(() => { vi.advanceTimersByTime(NARRATION_STEP_MS) })
    expect(screen.getByTestId('upload-narration').textContent).toBe('Almost filed…')
    act(() => { vi.advanceTimersByTime(NARRATION_STEP_MS * 5) })
    expect(screen.getByTestId('upload-narration').textContent).toBe('Almost filed…')
  })

  it('says how many pages when photos were merged', () => {
    render(<UploadProgress name="scan.jpg" pages={3} />)
    expect(screen.getByText('3 pages')).toBeTruthy()
  })
})


describe('UploadProgress for a personal file (round 21, A3, DECISIONS #101)', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    await i18n.changeLanguage('en')
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('says it is saving, and never tells the story of reading a document that is not being read', () => {
    render(<UploadProgress name="Passport" personal />)
    expect(screen.getByTestId('upload-narration').textContent).toBe('Saving to Only me…')
    act(() => { vi.advanceTimersByTime(NARRATION_STEP_MS * 5) })
    expect(screen.getByTestId('upload-narration').textContent).toBe('Saving to Only me…')
    for (const line of ['Reading your document…', 'Pulling out the details…', 'Almost filed…']) expect(screen.queryByText(line)).toBeNull()
  })

  it('a company upload still narrates as before', () => {
    render(<UploadProgress name="invoice.pdf" />)
    expect(screen.getByTestId('upload-narration').textContent).toBe('Reading your document…')
  })
})
