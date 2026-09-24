/** A bare scratchpad for the Only me section (2026-09-25, round 19, DECISIONS #94):
 * a white canvas, one black pen, Clear, and Save. No undo, eraser, colours or sizes,
 * on purpose. Save hands the drawing over as a PNG File; the page uploads it as a
 * private image like any other photo. The pad clears only after that upload worked, so
 * a failed save loses nothing.
 *
 * Drawing uses pointer events (mouse, pen and finger alike) with `touch-action: none`
 * on the canvas, so dragging a finger draws instead of scrolling the page. The canvas
 * has a fixed resolution and is shown at its container's width. */

import { PenLine, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { PAD_HEIGHT, PAD_WIDTH, scratchFileName, toPadPoint, type PadPoint } from './padGeometry'

const PEN_WIDTH = 3
// The shared Button has no disabled look; a pad button that is off must read as off.
const OFF_LOOK = 'disabled:cursor-not-allowed disabled:opacity-50'

interface Props {
  /** Hand the drawing over; resolves true when it was saved, so the pad can clear. */
  onSave: (file: File) => Promise<boolean>
  /** True while an upload is in flight: Save is off, drawing stays on. */
  busy: boolean
  onClose: () => void
}

export function Scratchpad({ onSave, busy, onClose }: Props) {
  const { t } = useTranslation()
  const canvas = useRef<HTMLCanvasElement>(null)
  const last = useRef<PadPoint | null>(null)
  const [hasInk, setHasInk] = useState(false)
  const [saving, setSaving] = useState(false)

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

  const clear = () => {
    paintWhite()
    setHasInk(false)
  }

  const save = () => {
    const element = canvas.current
    if (!element || !hasInk || saving) return
    setSaving(true)
    element.toBlob((blob) => {
      if (!blob) {
        setSaving(false)
        return
      }
      onSave(new File([blob], scratchFileName(new Date()), { type: 'image/png' }))
        .then((saved) => {
          if (saved) clear()
        })
        .finally(() => setSaving(false))
    }, 'image/png')
  }

  return (
    <div role="group" aria-labelledby="scratchpad-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="scratchpad-heading" className="flex items-center gap-2 text-[15px] font-medium text-ink">
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
        className="block aspect-[8/5] w-full cursor-crosshair touch-none rounded-control border border-line bg-white"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" className={OFF_LOOK} onClick={clear} disabled={!hasInk || saving}>
          {t('onlyMe.scratchpad.clear')}
        </Button>
        <Button size="sm" className={OFF_LOOK} onClick={save} disabled={!hasInk || saving || busy}>
          {t('onlyMe.scratchpad.save')}
        </Button>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-muted">{t('onlyMe.scratchpad.hint')}</p>
    </div>
  )
}
