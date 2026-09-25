import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { trackRequest, usePendingRequests } from './pendingRequests'

function Count() {
  return <p data-testid="count">{usePendingRequests()}</p>
}
afterEach(cleanup)

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('trackRequest / usePendingRequests', () => {
  it('counts a call while it is in flight and stops counting when it succeeds', async () => {
    render(<Count />)
    const a = deferred<string>()
    const tracked = trackRequest(a.promise)
    expect(tracked).toBe(a.promise) // the caller gets the very same promise
    await act(async () => {})
    expect(screen.getByTestId('count').textContent).toBe('1')
    await act(async () => { a.resolve('ok'); await a.promise })
    expect(screen.getByTestId('count').textContent).toBe('0')
  })

  it('counts several at once, and a FAILED call stops counting too (it must never leave the page "loading" forever)', async () => {
    render(<Count />)
    const a = deferred<string>()
    const b = deferred<string>()
    trackRequest(a.promise)
    trackRequest(b.promise).catch(() => undefined)
    await act(async () => {})
    expect(screen.getByTestId('count').textContent).toBe('2')
    await act(async () => { a.resolve('ok'); await a.promise })
    expect(screen.getByTestId('count').textContent).toBe('1')
    await act(async () => { b.reject(new Error('boom')); await b.promise.catch(() => undefined) })
    expect(screen.getByTestId('count').textContent).toBe('0')
  })
})
