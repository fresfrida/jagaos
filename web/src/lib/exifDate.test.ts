/** The client EXIF date reader (round 7, S1e, DECISIONS #138): the date a photo was TAKEN, from the original JPEG, before the browser re-encodes it. */

import { describe, expect, it, vi } from 'vitest'
import { exifStringToDay, EXIF_READ_BYTES, parseExifDate, readExifDate } from './exifDate'
import { exifDateText, jpegWithExif } from './exifDate.testkit'

const orig = exifDateText(2024, 2, 5)
const digi = exifDateText(2023, 12, 15)
const ifd0 = exifDateText(2019, 8, 8)

describe('parseExifDate', () => {
  it.each(['LE', 'BE'] as const)('reads DateTimeOriginal in %s byte order', (order) => {
    expect(parseExifDate(jpegWithExif({ order, original: orig }))).toBe('2024-02-05')
  })

  it('prefers DateTimeOriginal, then DateTimeDigitized, then the IFD0 DateTime', () => {
    expect(parseExifDate(jpegWithExif({ original: orig, digitized: digi, ifd0 }))).toBe('2024-02-05')
    expect(parseExifDate(jpegWithExif({ digitized: digi, ifd0 }))).toBe('2023-12-15')
    expect(parseExifDate(jpegWithExif({ ifd0 }))).toBe('2019-08-08')
  })

  it.each(['LE', 'BE'] as const)('reads the IFD0 DateTime alone in %s byte order', (order) => {
    expect(parseExifDate(jpegWithExif({ order, ifd0 }))).toBe('2019-08-08')
  })

  it('finds the EXIF segment after an APP0 (JFIF) segment', () => {
    expect(parseExifDate(jpegWithExif({ withApp0: true, original: orig }))).toBe('2024-02-05')
  })

  it('a JPEG with an EXIF segment but no date tag, and one with no EXIF at all, are null', () => {
    expect(parseExifDate(jpegWithExif({}))).toBeNull()
    expect(parseExifDate(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]))).toBeNull()
  })

  it('an unset or invalid date ("0000:00:00 00:00:00", month 13, Feb 30, before 1990) falls through to the next tag, or null', () => {
    expect(parseExifDate(jpegWithExif({ original: '0000:00:00 00:00:00', ifd0 }))).toBe('2019-08-08')
    expect(parseExifDate(jpegWithExif({ original: exifDateText(2024, 13, 1), digitized: exifDateText(2024, 2, 30), ifd0: exifDateText(1989, 12, 31) }))).toBeNull()
    expect(parseExifDate(jpegWithExif({ original: 'not a date at all!!!!', ifd0 }))).toBe('2019-08-08')
  })

  it('every truncation of a valid file returns null or the date and never throws', () => {
    const full = jpegWithExif({ order: 'BE', original: orig, digitized: digi, ifd0, withApp0: true })
    for (let length = 0; length <= full.length; length++) {
      expect(() => parseExifDate(full.slice(0, length)), `length ${length}`).not.toThrow()
      const got = parseExifDate(full.slice(0, length))
      expect([null, '2024-02-05', '2023-12-15', '2019-08-08']).toContain(got)
    }
    expect(parseExifDate(full.slice(0, 30))).toBeNull()
  })

  it('a non-JPEG (PNG, GIF, PDF, text, empty) is null', () => {
    for (const bytes of [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0, 0], Array.from('%PDF-1.7 ...', (c) => c.charCodeAt(0)), [], [0xff]]) {
      expect(parseExifDate(Uint8Array.from(bytes))).toBeNull()
    }
  })

  it('corrupt structure (wrong magic, an offset outside the bytes, a giant count, a zero-length segment) is null and never throws', () => {
    const good = jpegWithExif({ original: orig })
    const badMagic = good.slice(); badMagic[good.indexOf(0x2a, 12)] = 0x2b
    const badOffset = good.slice(); badOffset[16] = 0xff; badOffset[17] = 0xff
    const zeroLength = good.slice(); zeroLength[4] = 0; zeroLength[5] = 0
    for (const bytes of [badMagic, badOffset, zeroLength]) {
      expect(() => parseExifDate(bytes)).not.toThrow()
      expect(parseExifDate(bytes)).toBeNull()
    }
  })

  it('random garbage never throws (a fuzz of 2,000 buffers, half of them starting like a JPEG)', () => {
    let seed = 12345
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed & 0xff }
    for (let i = 0; i < 2000; i++) {
      const bytes = Uint8Array.from({ length: 20 + (i % 400) }, rand)
      if (i % 2) { bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff; bytes[3] = 0xe1 }
      expect(() => parseExifDate(bytes)).not.toThrow()
    }
  })

  it('a huge input costs the same: the date is found at the front of a 20 MB buffer', () => {
    const head = jpegWithExif({ original: orig, tail: [] })
    const huge = new Uint8Array(20 * 1024 * 1024)
    huge.set(head)
    const start = performance.now()
    expect(parseExifDate(huge)).toBe('2024-02-05')
    expect(performance.now() - start).toBeLessThan(200)
  })
})

describe('exifStringToDay', () => {
  it('turns EXIF text into a day and rejects everything that is not a real day from 1990', () => {
    expect(exifStringToDay('2024:02:05 10:15:00')).toBe('2024-02-05')
    expect(exifStringToDay('2024:02:29 10:15:00')).toBe('2024-02-29')
    for (const bad of ['', '2023:02:29 00:00:00', '2024:00:10 00:00:00', '0000:00:00 00:00:00', '1989:12:31 00:00:00', '2024-02-05', 'abc', '2024:02']) {
      expect(exifStringToDay(bad), bad).toBeNull()
    }
  })
})

describe('readExifDate (a File)', () => {
  const file = (bytes: Uint8Array, name = 'photo.jpg', type = 'image/jpeg') => new File([bytes as BlobPart], name, { type })

  it('reads the date of a JPEG File', async () => {
    expect(await readExifDate(file(jpegWithExif({ original: orig })))).toBe('2024-02-05')
  })

  it('accepts a JPEG by its name when the type is empty, and refuses a PNG or a PDF without reading it', async () => {
    expect(await readExifDate(file(jpegWithExif({ original: orig }), 'IMG_0001.JPG', ''))).toBe('2024-02-05')
    const slice = vi.spyOn(File.prototype, 'slice')
    expect(await readExifDate(file(jpegWithExif({ original: orig }), 'photo.png', 'image/png'))).toBeNull()
    expect(await readExifDate(file(jpegWithExif({ original: orig }), 'a.pdf', 'application/pdf'))).toBeNull()
    expect(slice).not.toHaveBeenCalled()
    slice.mockRestore()
  })

  it('reads at most the first 256 KB of a large file', async () => {
    const big = new File([jpegWithExif({ original: orig, tail: [] }) as BlobPart, new Uint8Array(6 * 1024 * 1024) as BlobPart], 'big.jpg', { type: 'image/jpeg' })
    const slice = vi.spyOn(File.prototype, 'slice')
    expect(await readExifDate(big)).toBe('2024-02-05')
    expect(slice).toHaveBeenCalledWith(0, EXIF_READ_BYTES)
    slice.mockRestore()
  })

  it('a File that cannot be read, or has no EXIF, is null and never rejects', async () => {
    expect(await readExifDate(file(jpegWithExif({})))).toBeNull()
    const broken = file(jpegWithExif({ original: orig }))
    vi.spyOn(broken, 'slice').mockImplementation(() => { throw new Error('unreadable') })
    expect(await readExifDate(broken)).toBeNull()
  })
})

describe('against REAL JPEGs whose EXIF was written by Pillow (the seeded demo photos)', () => {
  it('reads every seeded photo\'s date-taken and agrees with the date the server stored for it', async () => {
    // @ts-expect-error node builtins are not in the browser tsconfig; vitest runs in node
    const fs = await import('node:fs')
    // @ts-expect-error same
    const path = await import('node:path')
    const root = path.resolve((globalThis as unknown as { process: { cwd(): string } }).process.cwd(), '../evals/seed_files')
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')) as { documents: Array<{ file: string; media: string; occurred_on: string }> }
    const photos = manifest.documents.filter((d) => d.media === 'jpg')
    expect(photos.length).toBeGreaterThanOrEqual(3)
    for (const photo of photos) {
      const bytes = new Uint8Array(fs.readFileSync(path.join(root, photo.file)))
      expect(parseExifDate(bytes), photo.file).toBe(photo.occurred_on)
      expect(await readExifDate(new File([bytes], path.basename(photo.file), { type: 'image/jpeg' })), photo.file).toBe(photo.occurred_on)
    }
  })
})
