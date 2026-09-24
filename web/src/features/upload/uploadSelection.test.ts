import { describe, expect, it } from 'vitest'
import {
  MAX_PAGES, appendPages, interpretDocumentSelection, movePage, removePage,
} from './uploadSelection'

const photo = (name: string) => new File(['x'], name, { type: 'image/jpeg' })
const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' })

describe('interpretDocumentSelection', () => {
  it('ignores an empty selection', () => {
    expect(interpretDocumentSelection([])).toEqual({ kind: 'none' })
  })

  it('treats one file — a PDF or a photo — as an ordinary upload', () => {
    const file = pdf('a.pdf')
    expect(interpretDocumentSelection([file])).toEqual({ kind: 'single', file })
    const image = photo('a.jpg')
    expect(interpretDocumentSelection([image])).toEqual({ kind: 'single', file: image })
  })

  it('turns several photos into pages, in the order given', () => {
    const files = [photo('b.jpg'), photo('a.jpg'), photo('c.jpg')]
    expect(interpretDocumentSelection(files)).toEqual({ kind: 'pages', files })
  })

  it('refuses a mix of a PDF and photos, and two PDFs', () => {
    expect(interpretDocumentSelection([photo('a.jpg'), pdf('b.pdf')])).toEqual({ kind: 'error', error: 'mixed' })
    expect(interpretDocumentSelection([pdf('a.pdf'), pdf('b.pdf')])).toEqual({ kind: 'error', error: 'mixed' })
  })

  it('refuses more photos than the backend OCR will read, instead of silently losing pages', () => {
    const tooMany = Array.from({ length: MAX_PAGES + 1 }, (_, i) => photo(`${i}.jpg`))
    expect(interpretDocumentSelection(tooMany)).toEqual({ kind: 'error', error: 'tooMany' })
    expect(interpretDocumentSelection(tooMany.slice(0, MAX_PAGES)).kind).toBe('pages')
  })
})

describe('appendPages', () => {
  it('adds pages after the existing ones', () => {
    const [a, b, c] = [photo('a.jpg'), photo('b.jpg'), photo('c.jpg')]
    expect(appendPages([a, b], [c])).toEqual({ files: [a, b, c], error: null })
  })

  it('refuses a non-image and leaves the pages alone', () => {
    const a = photo('a.jpg')
    expect(appendPages([a], [pdf('b.pdf')])).toEqual({ files: [a], error: 'mixed' })
  })

  it('refuses going past the cap and leaves the pages alone', () => {
    const full = Array.from({ length: MAX_PAGES }, (_, i) => photo(`${i}.jpg`))
    expect(appendPages(full, [photo('extra.jpg')])).toEqual({ files: full, error: 'tooMany' })
  })
})

describe('movePage / removePage', () => {
  it('moves a page earlier or later without mutating the input', () => {
    const pages = ['a', 'b', 'c']
    expect(movePage(pages, 2, -1)).toEqual(['a', 'c', 'b'])
    expect(movePage(pages, 0, 1)).toEqual(['b', 'a', 'c'])
    expect(pages).toEqual(['a', 'b', 'c'])
  })

  it('does nothing for a move off either end', () => {
    const pages = ['a', 'b', 'c']
    expect(movePage(pages, 0, -1)).toBe(pages)
    expect(movePage(pages, 2, 1)).toBe(pages)
  })

  it('removes one page', () => {
    expect(removePage(['a', 'b', 'c'], 1)).toEqual(['a', 'c'])
  })
})
