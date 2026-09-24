/** The DOCUMENT / PHOTO fork on the Upload page (2026-09-24, round 12,
 * DECISIONS #78) — two equal, loud buttons that ARE the file pickers.
 *
 * It replaces a small two-segment toggle that defaulted to "Document" and sat
 * above a dropzone, easy to miss and easy to leave on the wrong side for the
 * next file. Here there is no default and no separate setting: tapping the
 * button that describes what you have both makes the choice and opens the
 * picker for it, so the choice cannot be skipped or left stale. Both buttons
 * share every class, so neither reads as the unstated default.
 *
 * Presentational: it reports the files chosen and knows nothing about
 * uploading. DOCUMENT accepts several files (photos of one document's pages);
 * PHOTO accepts one image. */

import { Camera, FileText } from 'lucide-react'
import { useRef, type ChangeEvent, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/cn'

const CHOICE_CLASS = cn(
  'group flex min-h-[9.5rem] flex-col items-center justify-start gap-2 rounded-card border-2 border-ink bg-white px-3 pb-4 pt-5 text-center',
  'transition-colors hover:bg-ink hover:text-white focus-visible:bg-ink focus-visible:text-white',
  'outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2',
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-ink',
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
      <Icon size={30} aria-hidden="true" />
      <span className="text-base font-semibold uppercase tracking-[0.1em]">{title}</span>
      <span className="text-[12px] leading-snug text-muted group-hover:text-white/80 group-focus-visible:text-white/80">{hint}</span>
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
      <h2 id="upload-choice-heading" className="mb-3 text-[15px] font-medium text-ink">
        {t('ops.upload.pictureQuestion')}
      </h2>
      <div className="grid grid-cols-2 gap-3">
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
