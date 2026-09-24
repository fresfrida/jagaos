import { describe, expect, it } from 'vitest'
import { PAD_HEIGHT, PAD_WIDTH, scratchFileName, toPadPoint } from './padGeometry'

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
})
