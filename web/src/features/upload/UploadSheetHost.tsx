/** The universal Upload sheet (2026-09-24, round 16, item 10c): a bottom sheet with
 * the DOCUMENT / PHOTO choice, opened by the bottom nav's raised Upload button (and
 * by "Upload a replacement") on every page. Mounted once, under App, for anyone who
 * may upload.
 *
 * It picks; it does not upload. The chosen file is handed to the Upload page
 * (pendingSelection.ts), which owns the upload, its progress and the review queue.
 * The file inputs live inside UploadChoice, so the sheet stays open while the
 * system file picker is up (closing it first would unmount the input before its
 * change event) and closes only once something was chosen. */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '../../components/ui/BottomSheet'
import { roleAtLeast } from '../auth/authApi'
import { useAuth } from '../auth/AuthContext'
import { onOpenUploadSheet } from '../../lib/uploadTrigger'
import { handOffSelection, type UploadSelection } from './pendingSelection'
import { UploadChoice } from './UploadChoice'

export function UploadSheetHost() {
  const { t } = useTranslation()
  const { status, role } = useAuth()
  const [open, setOpen] = useState(false)
  const canUpload = status === 'signed-in' && role !== null && roleAtLeast(role, 'user')

  useEffect(() => {
    if (!canUpload) return
    return onOpenUploadSheet(() => setOpen(true))
  }, [canUpload])

  const choose = useCallback((selection: UploadSelection) => {
    setOpen(false)
    handOffSelection(selection)
  }, [])

  if (!canUpload) return null
  return (
    <BottomSheet open={open} onClose={() => setOpen(false)} title={t('ops.upload.pictureQuestion')}>
      <UploadChoice
        disabled={false}
        showHeading={false}
        onDocumentFiles={(files) => choose({ kind: 'document', files })}
        onPhotoFile={(file) => choose({ kind: 'photo', file })}
      />
    </BottomSheet>
  )
}
