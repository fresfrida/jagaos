/** `formatDateTime` (round 6, DECISIONS #129): the History panel's "23 Sept 2026, 2:14 pm". The API's timestamps are UTC with no zone
 * suffix ("2026-09-23 06:14:00"); shown in the COMPANY's timezone, not the viewing device's, so an entry never lands on the wrong day. */

import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_TIMEZONE, formatDateTime } from './dates'

describe('formatDateTime', () => {
  it('reads a zone-less API timestamp as UTC and shows it in the company timezone on a 12-hour clock', () => {
    expect(formatDateTime('2026-09-23 06:14:00')).toBe('23 Sept 2026, 2:14 pm')
    expect(DEFAULT_COMPANY_TIMEZONE).toBe('Asia/Singapore')
  })

  it('the same instant is a different wall clock, and can be a different day, in another company timezone', () => {
    expect(formatDateTime('2026-09-23 20:30:00', 'en-GB', 'Asia/Singapore')).toBe('24 Sept 2026, 4:30 am')
    expect(formatDateTime('2026-09-23 20:30:00', 'en-GB', 'America/New_York')).toBe('23 Sept 2026, 4:30 pm')
  })

  it('the ISO "T" form with or without a Z lands on the same instant as the space form', () => {
    const a = formatDateTime('2026-09-23 06:14:00')
    expect(formatDateTime('2026-09-23T06:14:00')).toBe(a)
    expect(formatDateTime('2026-09-23T06:14:00Z')).toBe(a)
  })

  it('follows the viewer\'s language for the words but never the device clock', () => {
    expect(formatDateTime('2026-09-23 06:14:00', 'zh-CN')).toMatch(/2026/)
    expect(formatDateTime('2026-09-23 06:14:00', 'zh-CN')).not.toContain('Sept')
  })
})
