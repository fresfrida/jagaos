import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TypedConfirmDialog } from './TypedConfirmDialog'

afterEach(cleanup)

const show = (over: Partial<React.ComponentProps<typeof TypedConfirmDialog>> = {}) => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  const view = render(
    <TypedConfirmDialog
      open message="This is permanent." prompt="Type the name." expected="my file (1).pdf" inputLabel="Name"
      confirmLabel="Delete for good" cancelLabel="Cancel" onConfirm={onConfirm} onCancel={onCancel} {...over}
    />,
  )
  return { onConfirm, onCancel, ...view }
}
const field = () => screen.getByLabelText('Name') as HTMLInputElement
const confirm = () => screen.getByRole('button', { name: 'Delete for good' }) as HTMLButtonElement

describe('TypedConfirmDialog', () => {
  it('shows what will happen, and the exact text to type, in full', () => {
    show({ expected: 'a-very-long-name-'.repeat(6) + '.pdf' })
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText('This is permanent.')).toBeTruthy()
    expect(screen.getByTestId('typed-confirm-expected').textContent).toBe('a-very-long-name-'.repeat(6) + '.pdf')
    expect(screen.getByTestId('typed-confirm-expected').className).toContain('break-all') // readable and typeable on a phone
  })

  it('the confirm button is off until the text matches exactly, case, spaces and all', () => {
    show()
    expect(confirm().disabled).toBe(true)
    for (const wrong of ['my file (1).PDF', 'my file (1).pdf ', ' my file (1).pdf', 'my file', '']) {
      fireEvent.change(field(), { target: { value: wrong } })
      expect(confirm().disabled, JSON.stringify(wrong)).toBe(true)
    }
    fireEvent.change(field(), { target: { value: 'my file (1).pdf' } })
    expect(confirm().disabled).toBe(false)
  })

  it('confirms only when it matches: by the button and by Enter', () => {
    const { onConfirm } = show()
    fireEvent.submit(field().closest('form')!) // Enter on a wrong or empty field
    expect(onConfirm).not.toHaveBeenCalled()

    fireEvent.change(field(), { target: { value: 'my file (1).pdf' } })
    fireEvent.click(confirm())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('never confirms while busy, even with the right text', () => {
    const { onConfirm } = show({ busy: true })
    fireEvent.change(field(), { target: { value: 'my file (1).pdf' } })
    expect(confirm().disabled).toBe(true)
    fireEvent.submit(field().closest('form')!)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Cancel, Escape and the backdrop cancel; a click inside does not', () => {
    const { onCancel } = show()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('alertdialog'))
    expect(onCancel).toHaveBeenCalledTimes(3)

    fireEvent.click(field())
    expect(onCancel).toHaveBeenCalledTimes(3)
  })

  it('opens empty every time, so a second delete is never one keystroke from done', () => {
    const { rerender, onConfirm, onCancel } = show()
    fireEvent.change(field(), { target: { value: 'my file (1).pdf' } })
    rerender(<TypedConfirmDialog open={false} message="m" prompt="p" expected="my file (1).pdf" inputLabel="Name" confirmLabel="Delete for good" cancelLabel="Cancel" onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.queryByRole('alertdialog')).toBeNull()

    rerender(<TypedConfirmDialog open message="m" prompt="p" expected="my file (1).pdf" inputLabel="Name" confirmLabel="Delete for good" cancelLabel="Cancel" onConfirm={onConfirm} onCancel={onCancel} />)
    expect(field().value).toBe('')
    expect(confirm().disabled).toBe(true)
  })

  it('shows an error under the field, and renders nothing when closed', () => {
    const { rerender, onConfirm, onCancel } = show({ error: 'nope' })
    expect(screen.getByRole('alert').textContent).toBe('nope')
    rerender(<TypedConfirmDialog open={false} message="m" prompt="p" expected="x" inputLabel="Name" confirmLabel="c" cancelLabel="x" onConfirm={onConfirm} onCancel={onCancel} />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('does not autocorrect or spell-check what is typed', () => {
    show()
    expect(field().getAttribute('autocomplete')).toBe('off')
    expect(field().getAttribute('spellcheck')).toBe('false')
    expect(field().getAttribute('autocapitalize')).toBe('off')
  })
})
