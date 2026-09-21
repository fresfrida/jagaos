export const DAY_START_HOUR = 8
export const DAY_END_HOUR = 18
export const HOUR_HEIGHT_PX = 64

export function toMinutes(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number)
  return h * 60 + m
}

export function formatTimeRange(start: string, end: string): string {
  return `${start}–${end}`
}

export function eventPosition(start: string, end: string): { top: number; height: number } {
  const pxPerMinute = HOUR_HEIGHT_PX / 60
  return {
    top: (toMinutes(start) - DAY_START_HOUR * 60) * pxPerMinute,
    height: Math.max((toMinutes(end) - toMinutes(start)) * pxPerMinute, 28),
  }
}
