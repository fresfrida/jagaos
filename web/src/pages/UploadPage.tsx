/** Upload a document, watch it land in the review queue, confirm or
 * reject it — the former "Upload & Review" tab, now its own top-level
 * route (2026-09-23, header/nav restructure: promotes each OpsConsole tab
 * to a URL-addressable page). Data-fetching comes from the shared
 * useOpsData hook instead of OpsConsole's own state.
 *
 * 2026-09-24 (round 12, DECISIONS #78): the "is this a picture?" toggle and
 * the single dropzone are now one two-way choice, DOCUMENT or PHOTO
 * (features/upload/UploadChoice), and DOCUMENT accepts several photos as the
 * ordered pages of one document (PageStager). The upload logic lives in
 * useUploadFlow; this page composes.
 *
 * Round 16: the upload shows a progress moment (UploadProgress) instead of a line
 * of text; the "rejected, upload a replacement?" prompt is a dismissible bottom
 * sheet shown once after a rejection instead of a permanent inline block; a file
 * chosen in the universal Upload sheet (opened from any page, UploadSheetHost) is
 * handed to this page (pendingSelection.ts) and uploaded here; and a `?for=` link
 * from a missing compliance-checklist row becomes a hint on the upload. */

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { FileName } from '../components/ui/FileName'
import { Toast, useToast } from '../components/ui/Toast'
import { useAuth } from '../features/auth/AuthContext'
import { RequireSession } from '../features/auth/RequireSession'
import { roleAtLeast } from '../features/auth/authApi'
import { OpsStatusBar } from '../features/ops/OpsStatusBar'
import { ReviewQueueCard } from '../features/ops/ReviewQueueCard'
import { VENDOR_NAMES_DATALIST_ID } from '../features/ops/opsShared'
import { type UploadResult } from '../features/ops/opsApi'
import { useOpsData } from '../features/ops/useOpsData'
import { HintBanner } from '../features/upload/HintBanner'
import { onSelectionHandedOff, takePendingSelection } from '../features/upload/pendingSelection'
import { UploadPanel } from '../features/upload/UploadPanel'
import { uploadErrorMessage } from '../features/upload/uploadErrorMessage'
import { hintLabel, hintSlugFromSearch } from '../features/upload/uploadHint'
import { useUploadFlow } from '../features/upload/useUploadFlow'
import { openUploadSheet } from '../lib/uploadTrigger'
import { routeHref } from '../router/routes'

function UploadReviewContent() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const { documents, expectations, reviewItems, apiUp, error, setError, refresh } = useOpsData()

  const [justRejectedFilename, setJustRejectedFilename] = useState<string | null>(null)
  // The checklist item this upload was started for (`?for=<slug>`). Only honoured when
  // this company really has that item, so a stale or invented link is no hint at all.
  const [hintSlug, setHintSlug] = useState<string | null>(() => hintSlugFromSearch(window.location.search))
  const activeHintLabel = hintLabel(hintSlug, expectations)
  const clearHint = useCallback(() => {
    setHintSlug(null)
    window.history.replaceState(null, '', routeHref('upload'))
  }, [])
  const { toast, showToast, dismissToast } = useToast()

  const canUpload = role !== null && roleAtLeast(role, 'user')
  const canResolve = role !== null && roleAtLeast(role, 'admin')

  // 2026-09-24 (item 1): no document auto-files at upload time anymore
  // (DECISIONS #40 — every upload needs a human confirm, even a clean one),
  // so "filed" isn't a real upload-time outcome; the toast reports what
  // upload-time actually produces instead. review.reason still carries the
  // same routine ('clean') vs flagged distinction the review card itself
  // uses (isRoutine, ReviewQueueCard.tsx), just read here for one line.
  const onOutcome = useCallback(
    (result: UploadResult) => {
      if (result.status !== 'duplicate') clearHint() // the hint was for this one upload
      if (result.status === 'duplicate') showToast(t('ops.upload.toast.duplicate'), 'warning')
      else if (result.status === 'quarantined') showToast(t('ops.upload.toast.quarantined'), 'warning')
      else if (result.review?.reason === 'clean') showToast(t('ops.upload.toast.clean'), 'success')
      else showToast(t('ops.upload.toast.needsReview'), 'success')
    },
    [clearHint, showToast, t],
  )
  const onError = useCallback(
    (message: string | null, error?: unknown) => setError(message === null ? null : uploadErrorMessage(t, message, error)),
    [setError, t],
  )

  const flow = useUploadFlow({
    language: i18n.language, refresh, onOutcome, onError, docTypeHint: activeHintLabel ? hintSlug : null,
  })

  // A file chosen in the universal Upload sheet (opened from any page, including
  // this one) arrives here. Taken on mount for the case where the sheet navigated
  // to this page, and again on the event for the case where this page was already open.
  const { chooseDocumentFiles, uploadPhoto } = flow
  useEffect(() => {
    if (!canUpload) return
    const start = () => {
      const selection = takePendingSelection()
      if (selection === null) return
      if (selection.kind === 'photo') uploadPhoto(selection.file)
      else chooseDocumentFiles(selection.files)
    }
    start()
    return onSelectionHandedOff(start)
  }, [canUpload, chooseDocumentFiles, uploadPhoto])

  // 2026-09-22 (DECISIONS #45): vendor_name autocomplete source — distinct
  // values already on this company's documents, no new endpoint.
  const vendorNames = [...new Set(documents.map((d) => d.vendor_name).filter((v): v is string => Boolean(v)))].sort()

  return (
    <div>
      <OpsStatusBar apiUp={apiUp} />
      <datalist id={VENDOR_NAMES_DATALIST_ID}>
        {vendorNames.map((v) => <option key={v} value={v} />)}
      </datalist>

      {error && (
        <div className="mb-4 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      <div className="space-y-8">
        <Card className="p-6" interactive={false}>
          {canUpload ? (
            <>
              {activeHintLabel && <HintBanner label={activeHintLabel} onClear={clearHint} />}

              <UploadPanel flow={flow} />
            </>
          ) : (
            <p className="flex h-24 items-center justify-center rounded-card border border-dashed border-line text-sm text-muted">
              {t('ops.upload.viewerCantUpload')}
            </p>
          )}

        </Card>

        {reviewItems.length > 0 && (
          <section>
            <h2 className="mb-3 text-[12px] font-mono uppercase tracking-wide text-amber-800">
              {t('ops.review.needsReview', { count: reviewItems.length })}
            </h2>
            <div className="space-y-3">
              {reviewItems.map((item) => (
                <ReviewQueueCard
                  key={item.id}
                  item={item}
                  // The server's per-item answer wins where it sends one (an
                  // uploader may resolve their own personal file); an older
                  // backend sends none, and the role check is what it always was.
                  canResolve={item.can_resolve ?? canResolve}
                  onResolved={() => void refresh()}
                  onRejected={setJustRejectedFilename}
                  onPoll={() => void refresh()}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* 2026-09-23 (DECISIONS #50) closed the loop after a reject with an inline
         block that then stayed on the page for good. Round 16: it is a bottom
         sheet, shown once right after a rejection and dismissible, so it is not
         there the next time the page is opened. "Upload a replacement" hands over
         to the universal Upload sheet rather than picking a kind for the person. */}
      <BottomSheet
        open={justRejectedFilename !== null && canUpload}
        onClose={() => setJustRejectedFilename(null)}
        title={t('ops.upload.rejectedTitle')}
      >
        <p className="text-[14px] text-ink">
          {justRejectedFilename !== null && <FileName name={justRejectedFilename} max={36} className="font-medium" />}{' '}
          {t('ops.upload.rejectedPromptSuffix')}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setJustRejectedFilename(null)}>
            {t('ops.upload.rejectedDismiss')}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setJustRejectedFilename(null)
              openUploadSheet()
            }}
          >
            {t('ops.upload.uploadReplacement')}
          </Button>
        </div>
      </BottomSheet>

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}

export function UploadPage() {
  return (
    <RequireSession>
      <UploadReviewContent />
    </RequireSession>
  )
}
