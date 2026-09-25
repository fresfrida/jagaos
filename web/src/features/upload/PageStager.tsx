/** The ordered list of photos about to become ONE document (2026-09-24, round
 * 12, DECISIONS #78). Shown after DOCUMENT is used to pick two or more photos:
 * a picker's order is not always the order the pages were taken in, so the
 * person confirms it here — reorder, drop a page, add more — before anything
 * is sent. Presentational; the flow's state lives in useUploadFlow. */

import { ArrowDown, ArrowUp, Loader2, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { FileName } from '../../components/ui/FileName'
import { MAX_PAGES, type SelectionError } from './uploadSelection'

/** Object URLs for the page thumbnails, revoked when the list changes or
 * unmounts. Created inside the effect that revokes them, not in a useMemo: a
 * memoised URL is revoked by the cleanup of React StrictMode's dev-only
 * mount/unmount/mount pass and then never recreated, leaving broken images. */
function usePageThumbnails(files: File[]): string[] {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    const created = files.map((file) => URL.createObjectURL(file))
    setUrls(created)
    return () => created.forEach((url) => URL.revokeObjectURL(url))
  }, [files])
  return urls
}

export function PageStager({
  files,
  busy,
  error,
  onMove,
  onRemove,
  onAddMore,
  onSubmit,
  onCancel,
}: {
  files: File[]
  busy: boolean
  error: SelectionError | null
  onMove: (index: number, delta: number) => void
  onRemove: (index: number) => void
  onAddMore: (files: File[]) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const thumbnails = usePageThumbnails(files)
  const addInput = useRef<HTMLInputElement>(null)

  return (
    <section aria-labelledby="page-stager-heading" className="mt-6 rounded-card border border-line bg-canvas p-4">
      <h3 id="page-stager-heading" className="text-[15px] font-medium text-ink">
        {t('ops.upload.pages.heading', { count: files.length })}
      </h3>
      <p className="mt-0.5 text-[13px] text-muted">{t('ops.upload.pages.hint')}</p>

      <ol className="mt-3 space-y-2">
        {files.map((file, index) => (
          <li key={`${file.name}-${file.size}-${index}`} className="flex items-center gap-3 rounded-control border border-line bg-white p-2">
            <div className="h-14 w-11 shrink-0 overflow-hidden rounded-sm border border-line bg-canvas">
              {thumbnails[index] && <img src={thumbnails[index]} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-ink">{t('ops.upload.pages.pageLabel', { n: index + 1 })}</p>
              <p className="text-[13px] text-muted"><FileName name={file.name} max={30} /></p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Button variant="ghost" size="icon" disabled={busy || index === 0} onClick={() => onMove(index, -1)}
                aria-label={t('ops.upload.pages.moveUp', { n: index + 1 })}>
                <ArrowUp size={16} />
              </Button>
              <Button variant="ghost" size="icon" disabled={busy || index === files.length - 1} onClick={() => onMove(index, 1)}
                aria-label={t('ops.upload.pages.moveDown', { n: index + 1 })}>
                <ArrowDown size={16} />
              </Button>
              <Button variant="ghost" size="icon" disabled={busy} onClick={() => onRemove(index)}
                aria-label={t('ops.upload.pages.remove', { n: index + 1 })}>
                <X size={16} />
              </Button>
            </div>
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="mt-3 text-[14px] text-red-700">
          {t(`ops.upload.pages.error.${error}`, { max: MAX_PAGES })}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onSubmit} disabled={busy || files.length === 0}
          icon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}>
          {busy ? t('ops.upload.uploading') : t('ops.upload.pages.submit', { count: files.length })}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => addInput.current?.click()}
          disabled={busy || files.length >= MAX_PAGES} icon={<Plus size={14} />}>
          {t('ops.upload.pages.addMore')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          {t('common.buttons.cancel')}
        </Button>
      </div>
      <input
        ref={addInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="add-pages-input"
        onChange={(event) => {
          const added = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (added.length > 0) onAddMore(added)
        }}
      />
    </section>
  )
}
