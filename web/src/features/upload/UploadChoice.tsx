/** The Document / Photo fork on the Upload page — two equal choices that ARE
 * the file pickers (2026-09-24, round 12, DECISIONS #81; restyled in round 14,
 * DECISIONS #88).
 *
 * It replaced a small two-segment toggle that defaulted to "Document" above a
 * dropzone, easy to miss and easy to leave on the wrong side for the next
 * file. Here there is no default and no separate setting: tapping the row that
 * describes what you have both makes the choice and opens the picker for it, so
 * the choice cannot be skipped or left stale. Both rows share every class, so
 * neither reads as the unstated default.
 *
 * Round 14: two full-width rows separated by thin rules instead of two bordered
 * all-caps cards — icon on the left, a normal-case title, one short line under
 * it, a quiet chevron on the right to say "this opens something". Still equal
 * in weight; the change is elegance, not emphasis.
 *
 * Presentational: it reports the files chosen and knows nothing about
 * uploading. Document accepts several files (photos of one document's pages);
 * Photo accepts one image. */

import { Camera, ChevronRight, FileText } from 'lucide-react'
import { useRef, type ChangeEvent, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'

const CHOICE_CLASS = cn(
  'group flex w-full items-center gap-4 px-1 py-5 text-left',
  'transition-colors hover:bg-canvas focus-visible:bg-canvas',
  'outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
)

interface ChoiceProps {
  icon: typeof FileText
  title: string
  hint: string
  disabled: boolean
  onClick: () => void
}

function Choice({ icon: Icon, title, hint, disabled, onClick }: ChoiceProps) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={CHOICE_CLASS}>
      <Icon size={28} strokeWidth={1.75} className="shrink-0 text-ink" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-muted">{hint}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-muted group-hover:text-ink" aria-hidden="true" />
    </button>
  )
}

export function UploadChoice({
  disabled,
  onDocumentFiles,
  onPhotoFile,
  ref,
}: {
  disabled: boolean
  onDocumentFiles: (files: File[]) => void
  onPhotoFile: (file: File) => void
  ref?: Ref<HTMLDivElement>
}) {
  const { t } = useTranslation()
  const documentInput = useRef<HTMLInputElement>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  // Reset the input's value so choosing the same file again still fires onChange.
  const read = (event: ChangeEvent<HTMLInputElement>): File[] => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    return files
  }

  return (
    <div ref={ref} role="group" aria-labelledby="upload-choice-heading">
      <h2 id="upload-choice-heading" className="mb-1 text-[15px] font-medium text-ink">
        {t('ops.upload.pictureQuestion')}
      </h2>
      <div className="divide-y divide-line border-y border-line">
        <Choice
          icon={FileText}
          title={t('ops.upload.choice.document.title')}
          hint={t('ops.upload.choice.document.hint')}
          disabled={disabled}
          onClick={() => documentInput.current?.click()}
        />
        <Choice
          icon={Camera}
          title={t('ops.upload.choice.photo.title')}
          hint={t('ops.upload.choice.photo.hint')}
          disabled={disabled}
          onClick={() => photoInput.current?.click()}
        />
      </div>
      <input
        ref={documentInput}
        type="file"
        accept="application/pdf,image/*"
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="document-input"
        onChange={(event) => {
          const files = read(event)
          if (files.length > 0) onDocumentFiles(files)
        }}
      />
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="photo-input"
        onChange={(event) => {
          const [file] = read(event)
          if (file) onPhotoFile(file)
        }}
      />
    </div>
  )
}
