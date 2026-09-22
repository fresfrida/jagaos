/** Client-side photo cleanup before upload. Phone cameras hand back wildly
 * inconsistent files — arbitrary resolution, and (commonly) rotation
 * stored only in EXIF metadata rather than baked into the pixels — and
 * app/extract/ocr.py's pytesseract call does zero preprocessing, so a
 * skewed high-res photo produces bad extractions with no server-side fix
 * planned (2026-09-22). This does not deskew or crop — just removes the
 * cheap, client-side source of variance: resolution.
 *
 * Orientation is NOT handled manually here on purpose: createImageBitmap()
 * has applied EXIF-orientation correction by default ("from-image") in
 * every shipping browser for years — verified 2026-09-22 against Chrome
 * 153 (see docs/DECISIONS.md). An explicit imageOrientation: "none" to get
 * RAW pixels is a proposed-but-unshipped option (whatwg/html#8085) — it
 * isn't implemented anywhere yet, so requesting it is a no-op, not an
 * opt-out. A first version of this file hand-rolled its own EXIF-tag
 * reader and re-applied the rotation on top of createImageBitmap's output
 * — that double-applies the correction and visibly mis-rotates the image;
 * caught via a live browser test before shipping, not left in. */

const MAX_DIMENSION = 2000
const JPEG_QUALITY = 0.85

/** Downscales an image file before upload so neither dimension exceeds
 * MAX_DIMENSION (never upscales); PDFs and non-images pass through
 * untouched. Falls back to the original file on any failure (corrupt
 * image, unsupported format, no canvas API) — this is a quality
 * improvement, not a new failure mode. */
export async function normalizeImageForUpload(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const outWidth = Math.round(bitmap.width * scale)
    const outHeight = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = outWidth
    canvas.height = outHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, outWidth, outHeight)
    bitmap.close()

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob) return file

    const newName = file.name.replace(/\.[^./\\]+$/, '') + '.jpg'
    return new File([blob], newName, { type: 'image/jpeg' })
  } catch {
    return file
  }
}
