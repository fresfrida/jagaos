/** The date a photo was TAKEN, read from the ORIGINAL JPEG's EXIF before the browser re-encodes it (round 7, S1e, DECISIONS #138).
 *
 * WHY: lib/imageNormalize.ts redraws every photo on a canvas before upload, and a canvas has no EXIF, so a real phone photo used to arrive with no
 * date and its card said "No document date". The date is read here from the untouched file and sent as `taken_on`; the server uses it only for a
 * picture and only when its own EXIF read of the upload finds nothing (app/main.py, app/graph/ingest.py).
 *
 * WHAT: a small pure JPEG/TIFF walk with no dependency. APP1 "Exif" segment, TIFF header in either byte order, IFD0, the Exif IFD pointer (0x8769),
 * then DateTimeOriginal (0x9003), DateTimeDigitized (0x9004) and IFD0 DateTime (0x0132), in that order of preference. Returns "YYYY-MM-DD" or null.
 * It NEVER throws: any parse problem (a truncated file, an offset outside the bytes, a non-JPEG, garbage) is null, and it reads at most the first
 * 256 KB of a file, so a huge one costs the same as a small one. */

/** How much of the file is read: EXIF sits in the first APP1 segment, at most 64 KB long, right after the start-of-image marker. */
export const EXIF_READ_BYTES = 256 * 1024
const MAX_SEGMENTS = 24
const MAX_ENTRIES = 512
const EARLIEST_YEAR = 1990

const TAG_DATETIME = 0x0132
const TAG_EXIF_IFD = 0x8769
const TAG_DATETIME_ORIGINAL = 0x9003
const TAG_DATETIME_DIGITIZED = 0x9004

class Bytes {
  private readonly view: DataView
  constructor(readonly bytes: Uint8Array, private readonly end: number, private little = false) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  setLittle(little: boolean): void { this.little = little }
  u16(at: number): number { this.check(at, 2); return this.view.getUint16(at, this.little) }
  u32(at: number): number { this.check(at, 4); return this.view.getUint32(at, this.little) }
  check(at: number, length: number): void {
    if (!Number.isInteger(at) || at < 0 || length < 0 || at + length > this.end || at + length > this.bytes.length) throw new RangeError('outside the segment')
  }
  ascii(at: number, length: number): string {
    this.check(at, length)
    let out = ''
    for (let i = 0; i < length; i++) {
      const c = this.bytes[at + i]!
      if (c === 0) break
      out += String.fromCharCode(c)
    }
    return out
  }
}

/** "YYYY:MM:DD HH:MM:SS" (EXIF's own form) to "YYYY-MM-DD", or null when it is not a real calendar day from 1990 on ("0000:00:00 ..." is common and means unset). */
export function exifStringToDay(raw: string): string | null {
  const match = /^(\d{4}):(\d{2}):(\d{2})(?:\D|$)/.exec(raw.trim())
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (year < EARLIEST_YEAR) return null
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return `${match[1]}-${match[2]}-${match[3]}`
}

/** The bytes of one IFD as tag -> {type, count, valueField (the entry's 4-byte value/offset field position)}. */
function readIfd(view: Bytes, tiff: number, offset: number): Map<number, { type: number; count: number; field: number }> {
  const entries = new Map<number, { type: number; count: number; field: number }>()
  const at = tiff + offset
  const count = Math.min(view.u16(at), MAX_ENTRIES)
  for (let i = 0; i < count; i++) {
    const entry = at + 2 + i * 12
    entries.set(view.u16(entry), { type: view.u16(entry + 2), count: view.u32(entry + 4), field: entry + 8 })
  }
  return entries
}

function readAscii(view: Bytes, tiff: number, entry: { type: number; count: number; field: number } | undefined): string | null {
  if (!entry || entry.type !== 2 || entry.count < 10 || entry.count > 64) return null                    // EXIF dates are 20 bytes: "YYYY:MM:DD HH:MM:SS\0"
  return view.ascii(entry.count <= 4 ? entry.field : tiff + view.u32(entry.field), entry.count)
}

/** The date taken, from the bytes at the start of a JPEG. Pure; never throws. */
export function parseExifDate(input: Uint8Array): string | null {
  try {
    if (input.length < 12 || input[0] !== 0xff || input[1] !== 0xd8) return null                           // not a JPEG
    let pos = 2
    for (let segments = 0; segments < MAX_SEGMENTS && pos + 4 <= input.length; segments++) {
      if (input[pos] !== 0xff) return null
      while (input[pos + 1] === 0xff) pos++                                                                  // fill bytes
      const marker = input[pos + 1]!
      if (marker === 0xd9 || marker === 0xda) return null                                                    // end of image / start of scan: no EXIF before it
      if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01 || marker === 0xd8) { pos += 2; continue }
      const length = (input[pos + 2]! << 8) | input[pos + 3]!
      if (length < 2) return null
      const segmentEnd = pos + 2 + length
      const isExif = marker === 0xe1 && input[pos + 4] === 0x45 && input[pos + 5] === 0x78 && input[pos + 6] === 0x69 && input[pos + 7] === 0x66 && input[pos + 8] === 0 && input[pos + 9] === 0
      if (!isExif) { pos = segmentEnd; continue }
      const view = new Bytes(input, Math.min(segmentEnd, input.length))
      const tiff = pos + 10
      const order = view.u16(tiff)
      if (order !== 0x4949 && order !== 0x4d4d) return null
      view.setLittle(order === 0x4949)
      if (view.u16(tiff + 2) !== 0x002a) return null
      const ifd0 = readIfd(view, tiff, view.u32(tiff + 4))
      const exifPointer = ifd0.get(TAG_EXIF_IFD)
      const exif = exifPointer && exifPointer.type === 4 ? readIfd(view, tiff, view.u32(exifPointer.field)) : new Map()
      for (const entry of [exif.get(TAG_DATETIME_ORIGINAL), exif.get(TAG_DATETIME_DIGITIZED), ifd0.get(TAG_DATETIME)]) {
        let text: string | null = null
        try { text = readAscii(view, tiff, entry) } catch { text = null }                                       // one bad entry must not hide the next
        const day = text ? exifStringToDay(text) : null
        if (day) return day
      }
      return null
    }
    return null
  } catch {
    return null
  }
}

async function firstBytes(file: File): Promise<Uint8Array> {
  const blob = file.slice(0, EXIF_READ_BYTES)
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  return new Promise((resolve, reject) => {                                                                  // an older WebView without Blob.arrayBuffer
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

/** The date a JPEG photo was taken ("YYYY-MM-DD"), or null: not a JPEG, no EXIF, no usable date, or any error. Never rejects. */
export async function readExifDate(file: File): Promise<string | null> {
  try {
    if (!/^image\/jpe?g$/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return null
    return parseExifDate(await firstBytes(file))
  } catch {
    return null
  }
}
