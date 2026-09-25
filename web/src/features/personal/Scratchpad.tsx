/** A bare scratchpad for the Only me section (2026-09-25, round 19, DECISIONS #94): a
 * white canvas, one black pen, Clear, and Save. No undo, eraser, colours or sizes,
 * on purpose. Save hands the drawing over as a PNG File; the page uploads it as a
 * private image like any photo. The pad clears only after that upload worked, so
 * a failed save loses nothing.
 *
 * Round 20 (item 7) added a second, equally simple way to make the same kind of image:
 * Type. A textarea; Save draws the text in black on white onto an offscreen canvas and
 * hands it over exactly as a drawing is handed over. Still no formatting: it is not a
 * text editor. Each mode keeps what was put into it while the other is showing.
 *
 * Drawing uses pointer events (mouse, pen and finger alike) with `touch-action: none`
 * on the canvas, so dragging a finger draws instead of scrolling the page. The canvas
 * has a fixed resolution and is shown at its container's width. */

import { PenLine, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { cn } from '../../lib/cn'
import {
  MAX_TEXT_CHARS, PAD_HEIGHT, PAD_WIDTH, TEXT_LINE_HEIGHT, TEXT_MARGIN,
  scratchFileName, textImageHeight, toPadPoint, wrapText, type PadPoint,
} from './padGeometry'

const PEN_WIDTH = 3
// The shared Button has no disabled look; a pad button that is off must read as off.
const OFF_LOOK = 'disabled:cursor-not-allowed disabled:opacity-50'
const TEXT_FONT = `28px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`

type Mode = 'draw' | 'type'

interface Props {
  /** Hand the drawing over; resolves true when it was saved, so the pad can clear. */
  onSave: (file: File) => Promise<boolean>
  /** True while an upload is in flight: Save is off, drawing stays on. */
  busy: boolean
  onClose: () => void
}

/** The typed note as a canvas: white page, black text, wrapped to the pad's width. */
function renderTextCanvas(text: string): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.font = TEXT_FONT
  const lines = wrapText(text, PAD_WIDTH - TEXT_MARGIN * 2, (line) => ctx.measureText(line).width)
  canvas.width = PAD_WIDTH
  canvas.height = textImageHeight(lines.length)
  // Resizing a canvas resets its drawing state, so everything is set again after it.
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#000000'
  ctx.font = TEXT_FONT
  ctx.textBaseline = 'top'
  lines.forEach((line, index) => ctx.fillText(line, TEXT_MARGIN, TEXT_MARGIN + index * TEXT_LINE_HEIGHT))
  return canvas
}

export function Scratchpad({ onSave, busy, onClose }: Props) {
  const { t } = useTranslation()
  const canvas = useRef<HTMLCanvasElement>(null)
  const last = useRef<PadPoint | null>(null)
  const [mode, setMode] = useState<Mode>('draw')
  const [hasInk, setHasInk] = useState(false)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  const hasContent = mode === 'draw' ? hasInk : text.trim() !== ''

  const paintWhite = useCallback(() => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, PAD_WIDTH, PAD_HEIGHT)
  }, [])
  useEffect(paintWhite, [paintWhite])

  const point = (event: PointerEvent<HTMLCanvasElement>): PadPoint =>
    toPadPoint(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)

  const stroke = (from: PadPoint, to: PadPoint) => {
    const ctx = canvas.current?.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = PEN_WIDTH
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }

  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const at = point(event)
    last.current = at
    stroke(at, at) // a tap leaves a dot
    setHasInk(true)
  }
  const move = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return
    const at = point(event)
    stroke(last.current, at)
    last.current = at
  }
  const end = () => {
    last.current = null
  }

  /** Empties what the CURRENT mode holds; the other mode's content is left alone. */
  const clear = () => {
    if (mode === 'draw') {
      paintWhite()
      setHasInk(false)
    } else {
      setText('')
    }
  }

  const save = () => {
    if (!hasContent || saving) return
    const source = mode === 'draw' ? canvas.current : renderTextCanvas(text)
    if (!source) return
    setSaving(true)
    source.toBlob((blob) => {
      if (!blob) {
        setSaving(false)
        return
      }
      const name = scratchFileName(new Date(), mode === 'draw' ? 'scratchpad' : 'note')
      onSave(new File([blob], name, { type: 'image/png' }))
        .then((saved) => {
          if (saved) clear()
        })
        .finally(() => setSaving(false))
    }, 'image/png')
  }

  return (
    <div role="group" aria-labelledby="scratchpad-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="scratchpad-heading" className="flex items-center gap-2 text-[16px] font-medium text-ink">
          <PenLine size={18} aria-hidden="true" /> {t('onlyMe.scratchpad.title')}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('onlyMe.scratchpad.close')}
          className="rounded-control p-1 text-muted hover:bg-canvas hover:text-ink"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      {/* Draw or Type: the same segmented look as the Calendar's When filed / Document dates. */}
      <div role="group" aria-label={t('onlyMe.scratchpad.modeLabel')} className="mb-3 flex w-fit gap-0.5 rounded-control border border-line p-0.5">
        {(['draw', 'type'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            disabled={saving}
            onClick={() => setMode(value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-[14px] transition-colors',
              mode === value ? 'bg-ink text-white' : 'text-muted hover:text-ink',
            )}
          >
            {t(value === 'draw' ? 'onlyMe.scratchpad.modeDraw' : 'onlyMe.scratchpad.modeType')}
          </button>
        ))}
      </div>

      {/* Both stay mounted so switching modes loses nothing; only one is shown. */}
      <canvas
        ref={canvas}
        width={PAD_WIDTH}
        height={PAD_HEIGHT}
        aria-label={t('onlyMe.scratchpad.canvasLabel')}
        role="img"
        data-testid="scratchpad-canvas"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
        className={cn('aspect-[8/5] w-full cursor-crosshair touch-none rounded-control border border-line bg-white', mode === 'draw' ? 'block' : 'hidden')}
      />
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={MAX_TEXT_CHARS}
        aria-label={t('onlyMe.scratchpad.textLabel')}
        placeholder={t('onlyMe.scratchpad.textPlaceholder')}
        data-testid="scratchpad-text"
        className={cn(
          'aspect-[8/5] w-full resize-none rounded-control border border-line bg-white p-3 text-[16px] leading-6 text-ink outline-none focus:border-ink',
          mode === 'type' ? 'block' : 'hidden',
        )}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" className={OFF_LOOK} onClick={clear} disabled={!hasContent || saving}>
          {t('onlyMe.scratchpad.clear')}
        </Button>
        <Button size="sm" className={OFF_LOOK} onClick={save} disabled={!hasContent || saving || busy}>
          {t('onlyMe.scratchpad.save')}
        </Button>
      </div>
      <p className="mt-2 text-[13px] leading-5 text-muted">{t(mode === 'draw' ? 'onlyMe.scratchpad.hint' : 'onlyMe.scratchpad.hintText')}</p>
    </div>
  )
}
