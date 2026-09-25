/** The one question asked when a file goes into Only me (round 21, A3, DECISIONS #101): what to call it, and, if the person
 * likes, a caption. That is the whole form: no bucket, no document type, no vendor. It opens for a chosen file (or the ordered
 * pages of one document, or a scratchpad note) that has not been sent yet, and sending happens when the person saves.
 * The name starts as the file's own name without its extension, selected, so saving is one tap and renaming is typing.
 * Presentational: the draft and what save and cancel do come from useUploadFlow. */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '../../components/ui/BottomSheet'
import { Button } from '../../components/ui/Button'
import { FIELD_CLASS } from '../ops/opsShared'
import type { PersonalDetails, PersonalDraft } from '../upload/useUploadFlow'
import { PERSONAL_CAPTION_MAX, PERSONAL_NAME_MAX } from './personalDetails'

function DetailsForm({ draft, onSave, onCancel }: { draft: PersonalDraft; onSave: (details: PersonalDetails) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(draft.defaultName)
  const [caption, setCaption] = useState('')
  const nameInput = useRef<HTMLInputElement>(null)

  // The sheet moves focus to its own panel when it opens; take it back to the name, selected, once that has happened.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      nameInput.current?.focus()
      nameInput.current?.select()
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const trimmed = name.trim()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!trimmed) return
    const trimmedCaption = caption.trim()
    onSave(trimmedCaption ? { name: trimmed, caption: trimmedCaption } : { name: trimmed })
  }

  return (
    <form onSubmit={submit}>
      {draft.files.length > 1 && (
        <p className="mb-3 text-[13px] text-muted">{t('onlyMe.details.pages', { count: draft.files.length })}</p>
      )}
      <label className="block text-[14px] text-muted">
        {t('onlyMe.details.nameLabel')}
        <input
          ref={nameInput}
          value={name}
          maxLength={PERSONAL_NAME_MAX}
          required
          onChange={(event) => setName(event.target.value)}
          className={`${FIELD_CLASS} mt-1`}
        />
      </label>
      <label className="mt-3 block text-[14px] text-muted">
        {t('onlyMe.details.captionLabel')}
        <textarea
          value={caption}
          rows={3}
          maxLength={PERSONAL_CAPTION_MAX}
          placeholder={t('onlyMe.details.captionPlaceholder')}
          onChange={(event) => setCaption(event.target.value)}
          className="mt-1 block w-full rounded-control border border-line bg-white px-2.5 py-1.5 text-[14px] text-ink outline-none focus:border-ink"
        />
      </label>
      <div className="mt-4 flex gap-2">
        <Button type="submit" size="sm" disabled={!trimmed}>{t('onlyMe.details.save')}</Button>
        <Button type="button" size="sm" variant="secondary" onClick={onCancel}>{t('common.buttons.cancel')}</Button>
      </div>
    </form>
  )
}

export function PersonalDetailsSheet({
  draft, onSave, onCancel,
}: {
  draft: PersonalDraft | null
  onSave: (details: PersonalDetails) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <BottomSheet open={draft !== null} onClose={onCancel} title={t('onlyMe.details.title')}>
      {draft && <DetailsForm key={`${draft.defaultName}|${draft.files.length}`} draft={draft} onSave={onSave} onCancel={onCancel} />}
    </BottomSheet>
  )
}
