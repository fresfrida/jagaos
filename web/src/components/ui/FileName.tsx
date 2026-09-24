import { DEFAULT_FILENAME_MAX, middleEllipsis } from '../../lib/filename'

/** A filename as it is DISPLAYED: cut in the middle so the start and the
 * extension both stay readable (lib/filename.ts), with the whole name in the
 * tooltip and for a screen reader (which should not hear "0…al.pdf"). Every
 * place that shows a filename uses this; only an editable filename field shows
 * the whole thing. */
export function FileName({ name, max = DEFAULT_FILENAME_MAX, className }: { name: string; max?: number; className?: string }) {
  return (
    <span title={name} className={className}>
      <span aria-hidden="true">{middleEllipsis(name, max)}</span>
      <span className="sr-only">{name}</span>
    </span>
  )
}
