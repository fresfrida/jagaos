import { describe, expect, it } from 'vitest'
import {
  MAX_TEXT_LINES, PAD_HEIGHT, PAD_WIDTH, TEXT_LINE_HEIGHT, TEXT_MARGIN,
  scratchFileName, textImageHeight, toPadPoint, wrapText,
} from './padGeometry'

const rect = { left: 10, top: 20, width: 400, height: 250 } // half the canvas's own 800 x 500

describe('toPadPoint', () => {
  it('scales a pointer position from screen pixels to the canvas\'s own', () => {
    expect(toPadPoint(rect, 210, 145)).toEqual({ x: 400, y: 250 })
    expect(toPadPoint(rect, 10, 20)).toEqual({ x: 0, y: 0 })
  })

  it('clamps a pointer that drifted outside the canvas', () => {
    expect(toPadPoint(rect, -500, 9999)).toEqual({ x: 0, y: PAD_HEIGHT })
    expect(toPadPoint(rect, 9999, -500)).toEqual({ x: PAD_WIDTH, y: 0 })
  })

  it('gives the origin for a box with no size, instead of NaN', () => {
    expect(toPadPoint({ left: 0, top: 0, width: 0, height: 0 }, 5, 5)).toEqual({ x: 0, y: 0 })
  })
})

describe('scratchFileName', () => {
  it('names the image by local date and time, zero padded', () => {
    expect(scratchFileName(new Date(2026, 8, 5, 4, 3, 2))).toBe('scratchpad-20260905-040302.png')
  })

  it('two saves a second apart get different names', () => {
    expect(scratchFileName(new Date(2026, 8, 25, 14, 30, 7))).not.toBe(scratchFileName(new Date(2026, 8, 25, 14, 30, 8)))
  })

  it('a typed note is named note-..., a drawing scratchpad-...', () => {
    const at = new Date(2026, 8, 25, 14, 30, 7)
    expect(scratchFileName(at, 'note')).toBe('note-20260925-143007.png')
    expect(scratchFileName(at)).toBe('scratchpad-20260925-143007.png')
  })
})

// Ten pixels a character, and a line that is 100 wide holds ten characters.
const ten = (text: string) => text.length * 10

describe('wrapText', () => {
  it('leaves a line that fits alone', () => {
    expect(wrapText('hello', 100, ten)).toEqual(['hello'])
  })

  it('wraps at spaces and never puts a line over the width', () => {
    const lines = wrapText('one two three four five', 100, ten)
    expect(lines).toEqual(['one two', 'three four', 'five'])
    expect(lines.every((line) => ten(line) <= 100)).toBe(true)
  })

  it('keeps explicit newlines, and a blank line between paragraphs stays blank', () => {
    expect(wrapText('first\n\nsecond', 100, ten)).toEqual(['first', '', 'second'])
    expect(wrapText('a\r\nb', 100, ten)).toEqual(['a', 'b'])
  })

  it('drops blank lines at the end but not in the middle', () => {
    expect(wrapText('a\n\n\n', 100, ten)).toEqual(['a'])
    expect(wrapText('\n\na', 100, ten)).toEqual(['', '', 'a'])
  })

  it('breaks a word too long for one line by character, so nothing runs off the image', () => {
    const lines = wrapText('abcdefghijklmnopqrstuvwxyz', 100, ten)
    expect(lines).toEqual(['abcdefghij', 'klmnopqrst', 'uvwxyz'])
  })

  it('handles text with no spaces at all, like Chinese, by the same rule', () => {
    expect(wrapText('一二三四五六七八九十一二三', 100, ten)).toEqual(['一二三四五六七八九十', '一二三'])
  })

  it('does not split an emoji or another astral character in half', () => {
    const lines = wrapText('😀'.repeat(12), 100, (text) => Array.from(text).length * 10)
    expect(lines).toEqual(['😀'.repeat(10), '😀'.repeat(2)])
  })

  it('collapses runs of spaces instead of drawing gaps, and returns nothing for empty or blank text', () => {
    expect(wrapText('a   b', 100, ten)).toEqual(['a b'])
    expect(wrapText('', 100, ten)).toEqual([])
    expect(wrapText('   \n  ', 100, ten)).toEqual([])
  })

  it('cuts at MAX_TEXT_LINES so the image stays a size a canvas can make', () => {
    const many = Array.from({ length: MAX_TEXT_LINES + 25 }, (_, i) => `line ${i}`).join('\n')
    const lines = wrapText(many, 1000, ten)
    expect(lines).toHaveLength(MAX_TEXT_LINES)
    expect(lines[0]).toBe('line 0')
  })
})

describe('textImageHeight', () => {
  it('is never shorter than the drawing pad', () => {
    expect(textImageHeight(1)).toBe(PAD_HEIGHT)
    expect(textImageHeight(0)).toBe(PAD_HEIGHT)
  })

  it('grows by one line height per line past what the pad holds, plus the margins', () => {
    const lines = 30
    expect(textImageHeight(lines)).toBe(TEXT_MARGIN * 2 + lines * TEXT_LINE_HEIGHT)
    expect(textImageHeight(lines + 1) - textImageHeight(lines)).toBe(TEXT_LINE_HEIGHT)
  })

  it('at the most lines still fits a canvas', () => {
    expect(textImageHeight(MAX_TEXT_LINES)).toBeLessThan(16384)
  })
})
