/** The Only me scratchpad (round 19, DECISIONS #94): bare on purpose, so the tests pin
 * what it must do (draw, clear, save as a PNG, keep the drawing if the save fails) and
 * what it must not offer (undo, eraser, colours). */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { Scratchpad } from './Scratchpad'

const ctx = {
  fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
  fillText: vi.fn(), measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
  fillStyle: '', strokeStyle: '', lineWidth: 0, lineCap: '', lineJoin: '', font: '', textBaseline: '',
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ctx) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' })))
})
afterEach(cleanup)

const pad = () => screen.getByTestId('scratchpad-canvas')
const drawStroke = () => {
  fireEvent.pointerDown(pad(), { clientX: 10, clientY: 10, pointerId: 1 })
  fireEvent.pointerMove(pad(), { clientX: 60, clientY: 40, pointerId: 1 })
  fireEvent.pointerUp(pad(), { clientX: 60, clientY: 40, pointerId: 1 })
}
const renderPad = (over: Partial<React.ComponentProps<typeof Scratchpad>> = {}) => {
  const onSave = vi.fn(async () => true)
  const onClose = vi.fn()
  render(<Scratchpad onSave={onSave} busy={false} onClose={onClose} {...over} />)
  return { onSave, onClose }
}

describe('Scratchpad', () => {
  it('starts as a white page with Clear and Save both off', () => {
    renderPad()
    expect(ctx.fillStyle).toBe('#ffffff')
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 500)
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Save as image' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('draws in one black pen and turns Clear and Save on', () => {
    renderPad()
    drawStroke()
    expect(ctx.strokeStyle).toBe('#000000')
    expect(ctx.stroke).toHaveBeenCalled()
    expect(ctx.lineTo).toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Save as image' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a single tap leaves a dot, and counts as ink', () => {
    renderPad()
    fireEvent.pointerDown(pad(), { clientX: 30, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(pad(), { clientX: 30, clientY: 30, pointerId: 1 })
    expect(ctx.stroke).toHaveBeenCalledTimes(1)
    expect((screen.getByRole('button', { name: 'Save as image' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a move with the pointer up draws nothing', () => {
    renderPad()
    fireEvent.pointerMove(pad(), { clientX: 60, clientY: 40, pointerId: 1 })
    expect(ctx.stroke).not.toHaveBeenCalled()
  })

  it('Clear repaints the page white and turns Save off again', () => {
    renderPad()
    drawStroke()
    ctx.fillRect.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 500)
    expect((screen.getByRole('button', { name: 'Save as image' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Save hands over a PNG file named by the time, then clears the page', async () => {
    const { onSave } = renderPad()
    drawStroke()

    fireEvent.click(screen.getByRole('button', { name: 'Save as image' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const file = (onSave.mock.calls[0] as unknown as [File])[0]
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png')
    expect(file.type).toBe('image/png')
    expect(file.name).toMatch(/^scratchpad-\d{8}-\d{6}\.png$/)
    await waitFor(() => expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(true))
  })

  it('if the save did not go through the drawing is kept', async () => {
    const failing = vi.fn(async () => false)
    renderPad({ onSave: failing })
    drawStroke()

    fireEvent.click(screen.getByRole('button', { name: 'Save as image' }))

    await waitFor(() => expect(failing).toHaveBeenCalledTimes(1))
    await act(async () => { await Promise.resolve() })
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Save as image' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('cannot be saved while an upload is already running', () => {
    renderPad({ busy: true })
    drawStroke()
    expect((screen.getByRole('button', { name: 'Save as image' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers no undo, eraser or colours, and can be closed', () => {
    const { onClose } = renderPad()
    expect(screen.getAllByRole('button').map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual(['Close the scratchpad', 'Draw', 'Type', 'Clear', 'Save as image'])
    fireEvent.click(screen.getByRole('button', { name: 'Close the scratchpad' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('the canvas does not let a finger scroll the page instead of drawing', () => {
    renderPad()
    expect(pad().className).toContain('touch-none')
  })
})

// --- Type mode (round 20, item 7) ---

const typeMode = () => fireEvent.click(screen.getByRole('button', { name: 'Type' }))
const typeText = (value: string) => fireEvent.change(screen.getByTestId('scratchpad-text'), { target: { value } })
const saveButton = () => screen.getByRole('button', { name: 'Save as image' }) as HTMLButtonElement
const clearButton = () => screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement

describe('Scratchpad, Type mode', () => {
  it('starts in Draw, and Type shows a textarea instead of the canvas', () => {
    renderPad()
    expect(screen.getByRole('button', { name: 'Draw' }).getAttribute('aria-pressed')).toBe('true')
    expect(pad().className).toContain('block')
    expect(screen.getByTestId('scratchpad-text').className).toContain('hidden')

    typeMode()

    expect(screen.getByRole('button', { name: 'Type' }).getAttribute('aria-pressed')).toBe('true')
    expect(pad().className).toContain('hidden')
    expect(screen.getByTestId('scratchpad-text').className).toContain('block')
    expect(screen.getByText('Saved as a private image of your text, in your files below.')).toBeTruthy()
  })

  it('Save and Clear stay off until something is typed, and blank text does not count', () => {
    renderPad()
    typeMode()
    expect(saveButton().disabled).toBe(true)
    expect(clearButton().disabled).toBe(true)

    typeText('   \n  ')
    expect(saveButton().disabled).toBe(true)

    typeText('Buy stamps')
    expect(saveButton().disabled).toBe(false)
    expect(clearButton().disabled).toBe(false)
  })

  it('Save draws the text in black on white, wrapped, and hands over a PNG named note-...', async () => {
    const { onSave } = renderPad()
    typeMode()
    // ten pixels a character, the image is 800 wide with a 40 margin, so 72 characters a line
    typeText(`${'word '.repeat(30)}end`)

    fireEvent.click(saveButton())

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const file = (onSave.mock.calls[0] as unknown as [File])[0]
    expect(file.type).toBe('image/png')
    expect(file.name).toMatch(/^note-\d{8}-\d{6}\.png$/)
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png')
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, expect.any(Number)) // a white page first
    expect(ctx.fillStyle).toBe('#000000') // then black text
    const drawn = ctx.fillText.mock.calls.map((call) => call[0] as string)
    expect(drawn.length).toBeGreaterThan(1) // it wrapped
    expect(drawn.every((line) => line.length * 10 <= 720)).toBe(true) // and no line runs off the image
    expect(drawn.join(' ')).toBe(`${'word '.repeat(30)}end`)
  })

  it('clears the text after a good save, and keeps it when the save failed', async () => {
    const failing = vi.fn(async () => false)
    const { rerender } = render(<Scratchpad onSave={failing} busy={false} onClose={vi.fn()} />)
    typeMode()
    typeText('keep me')
    fireEvent.click(saveButton())
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(1))
    await act(async () => { await Promise.resolve() })
    expect((screen.getByTestId('scratchpad-text') as HTMLTextAreaElement).value).toBe('keep me')

    const working = vi.fn(async () => true)
    rerender(<Scratchpad onSave={working} busy={false} onClose={vi.fn()} />)
    fireEvent.click(saveButton())
    await waitFor(() => expect(working).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((screen.getByTestId('scratchpad-text') as HTMLTextAreaElement).value).toBe(''))
  })

  it('Clear empties the text and leaves a drawing made in Draw alone', () => {
    renderPad()
    drawStroke()
    typeMode()
    typeText('a note')

    fireEvent.click(clearButton())

    expect((screen.getByTestId('scratchpad-text') as HTMLTextAreaElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    expect(saveButton().disabled).toBe(false) // the drawing is still there
  })

  it('switching modes loses nothing in either', () => {
    renderPad()
    drawStroke()
    typeMode()
    typeText('still here')

    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    typeMode()

    expect((screen.getByTestId('scratchpad-text') as HTMLTextAreaElement).value).toBe('still here')
  })

  it('the Save in Draw mode still saves the drawing, not the text typed in the other mode', async () => {
    const { onSave } = renderPad()
    typeMode()
    typeText('typed but not shown')
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }))
    drawStroke()

    fireEvent.click(saveButton())

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect((onSave.mock.calls[0] as unknown as [File])[0].name).toMatch(/^scratchpad-/)
    expect(ctx.fillText).not.toHaveBeenCalled()
  })

  it('cannot be saved while an upload is running, and limits how long a note can be', () => {
    renderPad({ busy: true })
    typeMode()
    typeText('x')
    expect(saveButton().disabled).toBe(true)
    expect((screen.getByTestId('scratchpad-text') as HTMLTextAreaElement).maxLength).toBe(1200)
  })
})
