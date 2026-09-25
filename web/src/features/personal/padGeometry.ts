/** The pure parts of the Only me scratchpad (Scratchpad.tsx) (2026-09-25, round 19, DECISIONS #94):
 * where a pointer landed on the canvas, and what the saved image is called. Kept out
 * of the component so they are testable without a canvas. Round 20 (item 7) added the text
 * mode's: wrapping typed text into lines that fit the image, and how tall that image is. */

/** The pad's fixed drawing resolution. The canvas is shown at the width of its
 * container, so a pointer position is scaled from CSS pixels to these. */
export const PAD_WIDTH = 800
export const PAD_HEIGHT = 500

export interface PadPoint {
  x: number
  y: number
}

/** A pointer position in the canvas's own pixels, clamped to the canvas. `rect` is the
 * canvas's on-screen box (getBoundingClientRect). A zero-sized box gives the origin. */
export function toPadPoint(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): PadPoint {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value))
  return {
    x: clamp(((clientX - rect.left) / rect.width) * PAD_WIDTH, PAD_WIDTH),
    y: clamp(((clientY - rect.top) / rect.height) * PAD_HEIGHT, PAD_HEIGHT),
  }
}

const two = (n: number) => String(n).padStart(2, '0')

/** "scratchpad-20260925-143007.png" (a drawing) or "note-20260925-143007.png" (typed text), in the
 * person's local time, so two saves in a session differ and a name is meaningful in Only me's list. */
export function scratchFileName(now: Date, prefix: 'scratchpad' | 'note' = 'scratchpad'): string {
  const date = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`
  const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  return `${prefix}-${date}-${time}.png`
}

// --- typed text (round 20, item 7) ---

/** Typed text is drawn onto a canvas the same width as the drawing pad, with this margin all round. */
export const TEXT_MARGIN = 40
export const TEXT_LINE_HEIGHT = 38
/** More lines than this are cut, so the image stays a size every browser's canvas can make. */
export const MAX_TEXT_LINES = 60
/** The textarea's own limit; well inside MAX_TEXT_LINES for ordinary text. */
export const MAX_TEXT_CHARS = 1200

/** Splits one over-long word (or a run of text with no spaces, like Chinese) into pieces that each fit. */
function breakLongWord(word: string, maxWidth: number, measure: (text: string) => number): string[] {
  const pieces: string[] = []
  let current = ''
  for (const character of Array.from(word)) {
    if (current !== '' && measure(current + character) > maxWidth) {
      pieces.push(current)
      current = character
    } else {
      current += character
    }
  }
  if (current !== '') pieces.push(current)
  return pieces
}

/** Wraps `text` into lines no wider than `maxWidth`, by the caller's own `measure` (a canvas's
 * measureText in the component, a character count in a test). Explicit newlines are kept (a blank
 * line stays blank); words break at spaces; a word too long for a line is broken by character;
 * trailing blank lines are dropped; more than MAX_TEXT_LINES lines are cut. */
export function wrapText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = []
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      if (word === '') continue
      const pieces = measure(word) > maxWidth ? breakLongWord(word, maxWidth, measure) : [word]
      for (const piece of pieces) {
        const candidate = line === '' ? piece : `${line} ${piece}`
        if (line !== '' && measure(candidate) > maxWidth) {
          lines.push(line)
          line = piece
        } else {
          line = candidate
        }
      }
    }
    lines.push(line)
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.slice(0, MAX_TEXT_LINES)
}

/** How tall the image for `lineCount` lines is: the margins plus the lines, never shorter than the pad. */
export function textImageHeight(lineCount: number): number {
  return Math.max(PAD_HEIGHT, TEXT_MARGIN * 2 + lineCount * TEXT_LINE_HEIGHT)
}
