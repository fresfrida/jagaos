import { afterEach, describe, expect, it, vi } from 'vitest'
import { startDownload } from './download'

afterEach(() => vi.restoreAllMocks())

describe('startDownload', () => {
  it('clicks a real anchor pointing at the URL, then leaves nothing behind in the page', () => {
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this) // jsdom would try to navigate
    })

    startDownload('https://box.example/api/documents/9/download?token=abc')

    expect(clicked).toHaveLength(1)
    expect(clicked[0]!.getAttribute('href')).toBe('https://box.example/api/documents/9/download?token=abc')
    expect(clicked[0]!.rel).toBe('noopener')
    expect(document.querySelector('a[href*="/download?token="]')).toBeNull() // removed again
  })

  it('does not use a blob: or data: URL of its own: it only ever follows the URL it was given', () => {
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this)
    })
    startDownload('/api/documents/9/download?token=abc')
    expect(clicked[0]!.href).not.toMatch(/^(blob|data):/)
    expect(clicked[0]!.hasAttribute('download')).toBe(false) // the response's own Content-Disposition names the file
  })
})
