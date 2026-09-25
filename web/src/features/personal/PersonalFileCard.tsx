/** One private file in Only me (round 21, A3, DECISIONS #101). It shows exactly five things: the file's thumbnail, its name,
 * its caption, the date it was uploaded, and View / Edit / Delete. Nothing else is rendered for a personal file: no bucket, no
 * document type, no vendor, no status, no review badge, no trace. It is its own component, not DocumentCard with things hidden,
 * so none of that can reappear by accident: a personal file is named by its owner and has no such fields.
 *
 * Edit changes the name and the caption. Delete asks the person to type the file's name and then deletes it for good (DECISIONS
 * #99), which is what frees one of the 15 slots. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { TypedConfirmDialog } from '../../components/ui/TypedConfirmDialog'
import { ApiError } from '../../lib/apiClient'
import { formatShortDate, localeFor } from '../../lib/dates'
import { middleEllipsis } from '../../lib/filename'
import { DocumentThumbnail } from '../ops/DocumentCard'
import { opsApi, type DocumentRow } from '../ops/opsApi'
import { descriptionFor, FIELD_CLASS } from '../ops/opsShared'
import { PERSONAL_CAPTION_MAX, PERSONAL_NAME_MAX } from './personalDetails'

const ACTION = 'text-[13px] font-mono uppercase tracking-wide text-muted'

export function PersonalFileCard({
  doc, canEdit, onView, onDelete, onSaved,
}: {
  doc: DocumentRow
  /** Edit and Delete are offered only to someone who may change the file (its owner); View always. */
  canEdit: boolean
  onView: () => void
  /** Delete for good: the caller sends it to the server; this component has already asked the person to type the name. */
  onDelete: () => void
  onSaved: () => void
}) {
  const { t, i18n } = useTranslation()
  const caption = descriptionFor(doc.description, i18n.language)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(doc.filename)
  const [captionDraft, setCaptionDraft] = useState(caption)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const startEditing = () => {
    setName(doc.filename)
    setCaptionDraft(caption)
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      await opsApi.editDocument(doc.id, { filename: trimmed, description: captionDraft.trim(), language: i18n.language })
      setEditing(false)
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? t('ops.documents.editForbidden') : e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4" interactive={false}>
      <div className="flex min-w-0 gap-3">
        <DocumentThumbnail documentId={doc.id} mediaType={doc.media_type} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium text-ink" data-testid="personal-file-name">{middleEllipsis(doc.filename, 60)}</p>
          {caption && <p className="mt-0.5 break-words text-[13px] text-ink/80" data-testid="personal-file-caption">{caption}</p>}
          <p className="mt-0.5 text-[13px] text-muted">
            {t('ops.dates.uploadDate')}: {formatShortDate(doc.received_at, localeFor(i18n.language))}
          </p>
        </div>
      </div>

      {editing && (
        <form
          className="mt-3 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <label className="block text-[13px] text-muted">
            {t('onlyMe.details.nameLabel')}
            <input value={name} maxLength={PERSONAL_NAME_MAX} required onChange={(e) => setName(e.target.value)} className={`${FIELD_CLASS} mt-1`} />
          </label>
          <label className="block text-[13px] text-muted">
            {t('onlyMe.details.captionLabel')}
            <textarea
              value={captionDraft}
              rows={2}
              maxLength={PERSONAL_CAPTION_MAX}
              onChange={(e) => setCaptionDraft(e.target.value)}
              className="mt-1 block w-full rounded-control border border-line bg-white px-2.5 py-1.5 text-[14px] text-ink outline-none focus:border-ink"
            />
          </label>
          {error && <p className="text-[13px] text-red-700" role="alert">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !name.trim()}>{t('common.buttons.save')}</Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={busy}>{t('common.buttons.cancel')}</Button>
          </div>
        </form>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" onClick={onView} className={`${ACTION} hover:text-ink`}>{t('ops.documents.view')}</button>
        {canEdit && !editing && <button type="button" onClick={startEditing} className={`${ACTION} hover:text-ink`}>{t('ops.documents.edit')}</button>}
        {canEdit && (
          <button type="button" onClick={() => setConfirmingDelete(true)} className={`${ACTION} hover:text-red-700`}>{t('ops.documents.delete')}</button>
        )}
      </div>

      <TypedConfirmDialog
        open={confirmingDelete}
        message={t('ops.documents.purge.message')}
        prompt={t('ops.documents.purge.prompt')}
        expected={doc.filename}
        inputLabel={t('ops.documents.purge.inputLabel')}
        confirmLabel={t('ops.documents.purge.confirm')}
        cancelLabel={t('common.buttons.cancel')}
        onConfirm={() => {
          setConfirmingDelete(false)
          onDelete()
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </Card>
  )
}
