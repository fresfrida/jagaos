import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { DateRangeFilter } from './DateRangeFilter'
import { NO_RANGE, type DateBasis, type DateRange } from './documentDates'

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

const show = (range: DateRange = NO_RANGE, basis: DateBasis = 'upload') => {
  const onBasisChange = vi.fn()
  const onRangeChange = vi.fn()
  render(<DateRangeFilter basis={basis} range={range} onBasisChange={onBasisChange} onRangeChange={onRangeChange} />)
  return { onBasisChange, onRangeChange }
}

describe('DateRangeFilter', () => {
  it('has a From and a To date input, and the Uploaded / Document dates switch', () => {
    show()
    expect((screen.getByLabelText('From') as HTMLInputElement).type).toBe('date')
    expect((screen.getByLabelText('To') as HTMLInputElement).type).toBe('date')
    expect(screen.getByRole('button', { name: 'Uploaded dates' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Document dates' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('reports a change to either end, keeping the other', () => {
    const { onRangeChange } = show({ from: '2026-01-01', to: '2026-02-01' })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-15' } })
    expect(onRangeChange).toHaveBeenLastCalledWith({ from: '2026-01-15', to: '2026-02-01' })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-03-01' } })
    expect(onRangeChange).toHaveBeenLastCalledWith({ from: '2026-01-01', to: '2026-03-01' })
  })

  it('stops the native picker offering a start after the end, and an end before the start', () => {
    show({ from: '2026-01-10', to: '2026-02-20' })
    expect((screen.getByLabelText('From') as HTMLInputElement).max).toBe('2026-02-20')
    expect((screen.getByLabelText('To') as HTMLInputElement).min).toBe('2026-01-10')
  })

  it('reports the basis the person picks', () => {
    const { onBasisChange } = show()
    fireEvent.click(screen.getByRole('button', { name: 'Document dates' }))
    expect(onBasisChange).toHaveBeenCalledWith('document')
  })

  it('offers Clear dates only once a range is set, and clearing empties both ends', () => {
    const { onRangeChange } = show({ from: '2026-01-01', to: '' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear dates' }))
    expect(onRangeChange).toHaveBeenCalledWith({ from: '', to: '' })
    cleanup()
    show()
    expect(screen.queryByRole('button', { name: 'Clear dates' })).toBeNull()
  })

  it('says so when the start is after the end', () => {
    show({ from: '2026-05-01', to: '2026-01-01' })
    expect(screen.getByRole('alert').textContent).toBe('The start date is after the end date.')
    cleanup()
    show({ from: '2026-01-01', to: '2026-05-01' })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
