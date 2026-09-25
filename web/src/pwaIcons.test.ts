/** The browser-tab, home-screen and PWA icons (DECISIONS #114): what index.html and the manifest point at must exist, and be PNG.
 * The pictures come from one master by scripts/make_logo_assets.py; this only guards that the references and the files agree, so a
 * renamed or deleted icon fails here and not as a silent 404 on the deployed site (docs/UAT-DEPLOYMENT.md has that history). */

import { describe, expect, it } from 'vitest'
import indexHtml from '../index.html?raw'
import manifestText from '../public/manifest.webmanifest?raw'

const publicFiles = Object.keys(import.meta.glob('../public/*')).map((path) => '/' + path.split('/').pop())
const manifest = JSON.parse(manifestText) as { icons: Array<{ src: string; sizes: string; type: string; purpose?: string }> }
const linkedIcons = [...indexHtml.matchAll(/<link\s+rel="(icon|apple-touch-icon)"[^>]*>/g)].map((m) => ({
  rel: m[1]!,
  href: /href="([^"]+)"/.exec(m[0])![1]!,
  type: /type="([^"]+)"/.exec(m[0])?.[1],
  sizes: /sizes="([^"]+)"/.exec(m[0])?.[1],
}))

describe('icons', () => {
  it('index.html links a 32px tab icon, a larger one, and an Apple touch icon, all PNG, all present in public/', () => {
    expect(linkedIcons.map((l) => l.href)).toEqual(['/icon-32.png', '/icon-192.png', '/apple-touch-icon.png'])
    for (const icon of linkedIcons) {
      expect(publicFiles, icon.href).toContain(icon.href)
      expect(icon.href).toMatch(/\.png$/)
      if (icon.rel === 'icon') expect(icon.type, icon.href).toBe('image/png')
    }
  })

  it('the manifest offers PNG icons at 192 and 512 (what Chrome needs to install it), each present in public/', () => {
    expect(manifest.icons.map((i) => i.sizes)).toEqual(['192x192', '512x512'])
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png')
      expect(icon.purpose).toBe('any')
      expect(publicFiles, icon.src).toContain(icon.src)
    }
  })

  it('the flat placeholder SVG is gone and nothing refers to it', () => {
    expect(publicFiles).not.toContain('/icon.svg')
    expect(indexHtml).not.toContain('icon.svg')
    expect(manifestText).not.toContain('icon.svg')
  })
})
