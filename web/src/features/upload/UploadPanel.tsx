/** The upload area shared by the Upload page and the Only me page (2026-09-25, round
 * 19, DECISIONS #94): the Document / Photo choice, or the progress moment while a file
 * is being sent, the selection error, and the ordered page list for several photos.
 * It was written inline in UploadPage; the Only me page needs exactly the same thing,
 * so it lives once here instead of being copied. Presentational: everything it shows
 * and every action it offers comes from the flow (useUploadFlow) it is handed. */

import { useTranslation } from 'react-i18next'
import { PageStager } from './PageStager'
import { UploadChoice } from './UploadChoice'
import { UploadProgress } from './UploadProgress'
import { MAX_PAGES } from './uploadSelection'
import type { UploadFlow } from './useUploadFlow'

export function UploadPanel({
  flow, disabled = false, personal = false,
}: {
  flow: UploadFlow
  /** Off for a reason that is not an upload in progress (the private-file limit is reached, DECISIONS #99). */
  disabled?: boolean
  /** The Only me variant (round 21, A3, DECISIONS #101): nothing is read or captioned, so the rows and the progress say so. */
  personal?: boolean
}) {
  const { t } = useTranslation()
  const hints = personal ? { document: t('onlyMe.choice.document.hint'), photo: t('onlyMe.choice.photo.hint') } : undefined
  return (
    <>
      {flow.busy && flow.uploading ? (
        <UploadProgress name={flow.uploading.name} pages={flow.uploading.pages} personal={personal} />
      ) : (
        <UploadChoice disabled={flow.busy || disabled} hints={hints} onDocumentFiles={flow.chooseDocumentFiles} onPhotoFile={flow.uploadPhoto} />
      )}

      {flow.selectionError && !flow.staged && (
        <p role="alert" className="mt-3 text-[14px] text-red-700">
          {t(`ops.upload.pages.error.${flow.selectionError}`, { max: MAX_PAGES })}
        </p>
      )}
      {flow.staged && !flow.busy && (
        <PageStager
          files={flow.staged}
          busy={flow.busy}
          error={flow.selectionError}
          onMove={flow.move}
          onRemove={flow.remove}
          onAddMore={flow.addPages}
          onSubmit={() => void flow.submitPages()}
          onCancel={flow.cancelStaging}
        />
      )}
    </>
  )
}
