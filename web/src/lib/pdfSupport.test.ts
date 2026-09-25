import { afterEach, describe, expect, it } from 'vitest'
import { canShowPdfInline } from './pdfSupport'

const setViewer = (value: boolean | undefined) => Object.defineProperty(navigator, 'pdfViewerEnabled', { value, configurable: true })

afterEach(() => {
  Reflect.deleteProperty(navigator, 'pdfViewerEnabled')
})

describe('canShowPdfInline', () => {
  it('is true where the browser says it has a PDF viewer (desktop Chrome, Firefox, Safari)', () => {
    setViewer(true)
    expect(canShowPdfInline()).toBe(true)
  })

  it('is false only when the browser says it has none (Android Chrome and Brave, a viewer switched off)', () => {
    setViewer(false)
    expect(canShowPdfInline()).toBe(false)
  })

  it('stays true for a browser too old to report it, so its behaviour does not change', () => {
    setViewer(undefined)
    expect(canShowPdfInline()).toBe(true)
  })
})
