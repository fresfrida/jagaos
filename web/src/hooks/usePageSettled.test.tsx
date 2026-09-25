/** "This page has finished loading" (DECISIONS #108): no API call in flight for a short quiet moment, per page. */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trackRequest } from '../lib/pendingRequests'
import { usePageSettled } from './usePageSettled'

function Probe({ pageKey }: { pageKey: string }) {
  return <p data-testid="settled">{String(usePageSettled(pageKey))}</p>
}
const settled = () => screen.getByTestId('settled').textContent

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('usePageSettled', () => {
  it('starts unsettled and settles after a quiet moment when nothing is loading', () => {
    render(<Probe pageKey="home:1" />)
    expect(settled()).toBe('false')
    act(() => { vi.advanceTimersByTime(250) })
    expect(settled()).toBe('false') // not yet: the quiet moment is 300ms
    act(() => { vi.advanceTimersByTime(100) })
    expect(settled()).toBe('true')
  })

  it('does not settle while a call is in flight, and settles a quiet moment after the last one returns', async () => {
    render(<Probe pageKey="calendar:1" />)
    let finish!: () => void
    act(() => { void trackRequest(new Promise<void>((res) => { finish = res })) })
    act(() => { vi.advanceTimersByTime(2000) })
    expect(settled()).toBe('false') // still asking for its data
    await act(async () => { finish(); await Promise.resolve() })
    act(() => { vi.advanceTimersByTime(200) })
    expect(settled()).toBe('false')
    act(() => { vi.advanceTimersByTime(150) })
    expect(settled()).toBe('true')
  })

  it('a call that starts inside the quiet moment restarts it', async () => {
    render(<Probe pageKey="files:1" />)
    act(() => { vi.advanceTimersByTime(200) })
    let finish!: () => void
    act(() => { void trackRequest(new Promise<void>((res) => { finish = res })) })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(settled()).toBe('false')
    await act(async () => { finish(); await Promise.resolve() })
    act(() => { vi.advanceTimersByTime(350) })
    expect(settled()).toBe('true')
  })

  it('goes back to unsettled on a NEW page, and stays settled through later requests on the same one', async () => {
    const { rerender } = render(<Probe pageKey="home:1" />)
    act(() => { vi.advanceTimersByTime(400) })
    expect(settled()).toBe('true')

    let finish!: () => void
    act(() => { void trackRequest(new Promise<void>((res) => { finish = res })) }) // a save, a search: the footer must not flicker away
    expect(settled()).toBe('true')
    await act(async () => { finish(); await Promise.resolve() })

    rerender(<Probe pageKey="search:1" />)
    expect(settled()).toBe('false')
    act(() => { vi.advanceTimersByTime(400) })
    expect(settled()).toBe('true')
  })

  it('gives up after five seconds, so a call that never returns cannot hide the footer for good', () => {
    render(<Probe pageKey="stuck:1" />)
    act(() => { void trackRequest(new Promise<void>(() => undefined)) })
    act(() => { vi.advanceTimersByTime(4900) })
    expect(settled()).toBe('false')
    act(() => { vi.advanceTimersByTime(200) })
    expect(settled()).toBe('true')
  })
})
