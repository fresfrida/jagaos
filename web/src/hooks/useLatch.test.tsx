/** A value that, once true, stays true (DECISIONS #112): the footer is revealed by the first page that settles and not hidden again. */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useLatch } from './useLatch'

function Probe({ value }: { value: boolean }) {
  return <p data-testid="latched">{String(useLatch(value))}</p>
}
const latched = () => screen.getByTestId('latched').textContent

afterEach(cleanup)

describe('useLatch', () => {
  it('is false until the value has been true', () => {
    const { rerender } = render(<Probe value={false} />)
    expect(latched()).toBe('false')
    rerender(<Probe value={false} />)
    expect(latched()).toBe('false')
  })

  it('is true in the same render the value first is, and stays true when the value goes back to false', () => {
    const { rerender } = render(<Probe value={false} />)
    rerender(<Probe value />)
    expect(latched()).toBe('true') // no extra render needed: it is derived while rendering
    rerender(<Probe value={false} />)
    expect(latched()).toBe('true') // the footer must not blink away on the next page
    rerender(<Probe value />)
    expect(latched()).toBe('true')
  })

  it('is true at once when the value starts true', () => {
    render(<Probe value />)
    expect(latched()).toBe('true')
  })
})
