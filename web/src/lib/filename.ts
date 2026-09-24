/** Shortening a filename for display (2026-09-24, round 16, item 3). CSS can only
 * cut the END of a line, which throws away the extension and the part of a name
 * that usually tells two files apart ("scan_0001...", "scan_0002..."). This keeps
 * the start and the tail of the name plus its extension and cuts the middle:
 * "invoice-2026-09-supplier-final.pdf" -> "invoice-2026-0…-final.pdf".
 *
 * The rule for every place a filename is SHOWN (an editable filename input is not
 * a display, it always holds the whole name). The character budget is an
 * approximation of a pixel width, which is all a script can do without measuring
 * the DOM; callers pass a `max` that suits their space. */

/** How many characters of an extension (dot included) still count as one. */
const MAX_EXTENSION_LENGTH = 6
/** The tail of the stem kept in front of the extension, at most. */
const MAX_TAIL = 8

export const DEFAULT_FILENAME_MAX = 28

export function middleEllipsis(name: string, max: number = DEFAULT_FILENAME_MAX): string {
  // Code points, not UTF-16 units: a name with an emoji or a CJK extension must not be cut mid-character.
  const chars = Array.from(name)
  if (chars.length <= max) return name

  const dot = chars.lastIndexOf('.')
  const hasExtension = dot > 0 && chars.length - dot <= MAX_EXTENSION_LENGTH
  const extension = hasExtension ? chars.slice(dot) : []
  const stem = hasExtension ? chars.slice(0, dot) : chars

  const budget = max - extension.length - 1 // what is left for the stem's two ends, minus the ellipsis itself
  if (budget < 3) return `${chars.slice(0, Math.max(max - 1, 1)).join('')}…` // no room for a middle cut

  const tail = Math.min(Math.ceil(budget / 3), MAX_TAIL, stem.length)
  const head = budget - tail
  return `${stem.slice(0, head).join('')}…${stem.slice(stem.length - tail).join('')}${extension.join('')}`
}
