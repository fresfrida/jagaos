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

describe('DateRangeFilter: the dd/mm/yyyy echo (DECISIONS #110)', () => {
  const echo = () => screen.queryByTestId('date-range-echo')

  it('says nothing when no range is set: there is nothing to echo', () => {
    show()
    expect(echo()).toBeNull()
  })

  it('echoes a full range in dd/mm/yyyy, whatever order the native inputs show', () => {
    show({ from: '2024-01-01', to: '2024-03-31' })
    expect(echo()!.textContent).toBe('Showing 01/01/2024 to 31/03/2024')
    cleanup()
    show({ from: '2026-09-05', to: '2026-12-25' })
    expect(echo()!.textContent).toBe('Showing 05/09/2026 to 25/12/2026') // day first: 5 September, not May 9th
  })

  it('echoes an open end as "from" or "up to"', () => {
    show({ from: '2024-02-29', to: '' })
    expect(echo()!.textContent).toBe('Showing from 29/02/2024')
    cleanup()
    show({ from: '', to: '2024-03-31' })
    expect(echo()!.textContent).toBe('Showing up to 31/03/2024')
  })

  it('leaves a backwards range to its own warning and does not echo it as if it were valid', () => {
    show({ from: '2026-05-01', to: '2026-01-01' })
    expect(echo()).toBeNull()
    expect(screen.getByRole('alert')).toBeTruthy()
  })

  it('is announced politely to a screen reader when it changes, and sits under the inputs', () => {
    show({ from: '2024-01-01', to: '2024-03-31' })
    expect(echo()!.getAttribute('aria-live')).toBe('polite')
    const inputs = screen.getByLabelText('To')
    expect(inputs.compareDocumentPosition(echo()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each([
    ['zh', '显示 01/01/2024 至 31/03/2024'],
    ['ms', 'Menunjukkan 01/01/2024 hingga 31/03/2024'],
    ['ta', '01/01/2024 முதல் 31/03/2024 வரை காட்டப்படுகிறது'],
  ])('reads in %s, with the dates still dd/mm/yyyy', async (language, text) => {
    await i18n.changeLanguage(language)
    show({ from: '2024-01-01', to: '2024-03-31' })
    expect(echo()!.textContent).toBe(text)
  })
})

