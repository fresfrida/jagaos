/** The pure parts of the Only me scratchpad (Scratchpad.tsx) (2026-09-25, round 19, DECISIONS #94):
 * where a pointer landed on the canvas, and what the saved image is called. Kept out
 * of the component so they are testable without a canvas. */

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

/** "scratchpad-20260925-143007.png", in the person's local time, so two saves in a
 * session differ and a name is meaningful in Only me's list. */
export function scratchFileName(now: Date): string {
  const date = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}`
  const time = `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`
  return `scratchpad-${date}-${time}.png`
}
