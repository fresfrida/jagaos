import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../i18n'
import { BottomSheet } from './BottomSheet'

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
})

const renderSheet = (open: boolean, onClose = vi.fn()) =>
  render(
    <>
      <button>opener</button>
      <BottomSheet open={open} onClose={onClose} title="What now?">
        <button>first</button>
        <button>last</button>
      </BottomSheet>
    </>,
  )

describe('BottomSheet', () => {
  it('renders nothing while closed', () => {
    renderSheet(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('is a named modal dialog with its title as heading and its children inside', () => {
    renderSheet(true)
    const dialog = screen.getByRole('dialog', { name: 'What now?' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('heading', { name: 'What now?' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'first' })).toBeTruthy()
  })

  it('takes focus when it opens and gives it back to the opener when it closes', () => {
    const { rerender } = renderSheet(false)
    const opener = screen.getByRole('button', { name: 'opener' })
    opener.focus()
    rerender(
      <>
        <button>opener</button>
        <BottomSheet open onClose={vi.fn()} title="What now?"><button>first</button></BottomSheet>
      </>,
    )
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
    rerender(
      <>
        <button>opener</button>
        <BottomSheet open={false} onClose={vi.fn()} title="What now?"><button>first</button></BottomSheet>
      </>,
    )
    expect(document.activeElement).toBe(opener)
  })

  it('closes on Escape, on the dimmed area and on the close button, but not on a click inside it', () => {
    const onClose = vi.fn()
    renderSheet(true, onClose)

    fireEvent.click(screen.getByRole('button', { name: 'first' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('bottom-sheet-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('keeps Tab inside the sheet, wrapping from last to first and back', () => {
    renderSheet(true)
    const close = screen.getByRole('button', { name: 'Close' })
    const last = screen.getByRole('button', { name: 'last' })

    last.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(close)

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('stops the page behind from scrolling while open and restores it after', () => {
    const { rerender } = renderSheet(true)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<BottomSheet open={false} onClose={vi.fn()} title="What now?"><span /></BottomSheet>)
    expect(document.body.style.overflow).toBe('')
  })

  it('a parent that passes a new onClose every render does not steal focus back', () => {
    const { rerender } = renderSheet(true, vi.fn())
    const last = screen.getByRole('button', { name: 'last' })
    last.focus()
    act(() => {
      rerender(
        <>
          <button>opener</button>
          <BottomSheet open onClose={vi.fn()} title="What now?"><button>first</button><button>last</button></BottomSheet>
        </>,
      )
    })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }))
  })
})
