/** Synthetic JPEG bytes with a real EXIF structure, for tests (round 7, S1e): either byte order, any subset of the three date tags, an optional APP0 in front. */

export interface ExifSpec {
  order?: 'LE' | 'BE'
  /** DateTimeOriginal (0x9003), DateTimeDigitized (0x9004) and IFD0 DateTime (0x0132), each as EXIF text "YYYY:MM:DD HH:MM:SS" or absent. */
  original?: string | null
  digitized?: string | null
  ifd0?: string | null
  withApp0?: boolean
  /** Bytes appended after the APP1 segment (default: an end-of-image marker). */
  tail?: number[]
}

export function exifDateText(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}:${String(m).padStart(2, '0')}:${String(d).padStart(2, '0')} 10:15:00`
}

export function jpegWithExif(spec: ExifSpec = {}): Uint8Array {
  const little = (spec.order ?? 'LE') === 'LE'
  const out: number[] = []
  const w16 = (v: number) => (little ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff])
  const w32 = (v: number) => (little ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff] : [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff])
  const text = (s: string) => [...Array.from(s, (c) => c.charCodeAt(0)), 0]

  const exifEntries: Array<[number, string]> = []
  if (spec.original != null) exifEntries.push([0x9003, spec.original])
  if (spec.digitized != null) exifEntries.push([0x9004, spec.digitized])
  const ifd0Count = (spec.ifd0 != null ? 1 : 0) + (exifEntries.length ? 1 : 0)

  // Layout: header (8) | IFD0 | IFD0 strings | Exif IFD | Exif strings
  const ifd0Size = 2 + ifd0Count * 12 + 4
  const ifd0Strings = spec.ifd0 != null ? text(spec.ifd0) : []
  const exifIfdOffset = 8 + ifd0Size + ifd0Strings.length
  const exifIfdSize = exifEntries.length ? 2 + exifEntries.length * 12 + 4 : 0
  let stringCursor = exifIfdOffset + exifIfdSize

  const tiff: number[] = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...w16(42), ...w32(8)]
  tiff.push(...w16(ifd0Count))
  if (spec.ifd0 != null) tiff.push(...w16(0x0132), ...w16(2), ...w32(ifd0Strings.length), ...w32(8 + ifd0Size))
  if (exifEntries.length) tiff.push(...w16(0x8769), ...w16(4), ...w32(1), ...w32(exifIfdOffset))
  tiff.push(...w32(0), ...ifd0Strings)
  if (exifEntries.length) {
    tiff.push(...w16(exifEntries.length))
    const strings: number[] = []
    for (const [tag, value] of exifEntries) {
      const bytes = text(value)
      tiff.push(...w16(tag), ...w16(2), ...w32(bytes.length), ...w32(stringCursor + strings.length))
      strings.push(...bytes)
    }
    tiff.push(...w32(0), ...strings)
  }

  out.push(0xff, 0xd8)
  if (spec.withApp0) out.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00)
  const segment = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff]
  out.push(0xff, 0xe1, ((segment.length + 2) >> 8) & 0xff, (segment.length + 2) & 0xff, ...segment)
  out.push(...(spec.tail ?? [0xff, 0xd9]))
  return Uint8Array.from(out)
}
