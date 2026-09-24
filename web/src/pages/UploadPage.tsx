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
 * useUploadFlow; this page composes. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Toast, useToast } from '../components/ui/Toast'
import { useAuth } from '../features/auth/AuthContext'
import { RequireSession } from '../features/auth/RequireSession'
import { roleAtLeast } from '../features/auth/authApi'
import { OpsStatusBar } from '../features/ops/OpsStatusBar'
import { ReviewQueueCard } from '../features/ops/ReviewQueueCard'
import { VENDOR_NAMES_DATALIST_ID } from '../features/ops/opsShared'
import { type UploadResult } from '../features/ops/opsApi'
import { useOpsData } from '../features/ops/useOpsData'
import { PageStager } from '../features/upload/PageStager'
import { UploadChoice } from '../features/upload/UploadChoice'
import { MAX_PAGES } from '../features/upload/uploadSelection'
import { useUploadFlow } from '../features/upload/useUploadFlow'
import { onTriggerUploadChoice } from '../lib/uploadTrigger'

function UploadReviewContent() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const { documents, reviewItems, apiUp, error, setError, refresh } = useOpsData()

  const [justRejectedFilename, setJustRejectedFilename] = useState<string | null>(null)
  const choiceRef = useRef<HTMLDivElement>(null)
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
      if (result.status === 'duplicate') showToast(t('ops.upload.toast.duplicate'), 'warning')
      else if (result.status === 'quarantined') showToast(t('ops.upload.toast.quarantined'), 'warning')
      else if (result.review?.reason === 'clean') showToast(t('ops.upload.toast.clean'), 'success')
      else showToast(t('ops.upload.toast.needsReview'), 'success')
    },
    [showToast, t],
  )
  const onError = useCallback((message: string | null) => setError(message), [setError])

  const flow = useUploadFlow({ language: i18n.language, refresh, onOutcome, onError })

  // The bottom nav's raised Upload button, and "upload a replacement" below,
  // bring the DOCUMENT / PHOTO choice into view and focus it: with two ways to
  // upload there is no single picker for them to open.
  const focusChoice = useCallback(() => {
    choiceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    choiceRef.current?.querySelector('button')?.focus()
  }, [])
  useEffect(() => {
    if (!canUpload) return
    return onTriggerUploadChoice(focusChoice)
  }, [canUpload, focusChoice])

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
              <UploadChoice
                ref={choiceRef}
                disabled={flow.busy}
                onDocumentFiles={flow.chooseDocumentFiles}
                onPhotoFile={flow.uploadPhoto}
              />

              {flow.busy && !flow.staged && (
                <p className="mt-3 text-[13px] text-muted" role="status">{t('ops.upload.uploading')}</p>
              )}
              {flow.selectionError && !flow.staged && (
                <p role="alert" className="mt-3 text-[13px] text-red-700">
                  {t(`ops.upload.pages.error.${flow.selectionError}`, { max: MAX_PAGES })}
                </p>
              )}
              {flow.staged && (
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
          ) : (
            <p className="flex h-24 items-center justify-center rounded-card border border-dashed border-line text-sm text-muted">
              {t('ops.upload.viewerCantUpload')}
            </p>
          )}

          {/* 2026-09-23 (DECISIONS #50): closes the loop after a reject
             — it used to just disappear from the queue with no
             indication of where it went or what to do next. Simple
             inline prompt, not a modal — "Upload a replacement" brings
             the DOCUMENT / PHOTO choice into view rather than picking a
             kind for the person. */}
          {justRejectedFilename && canUpload && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-canvas p-4 text-[13px]">
              <p className="text-ink">
                <span className="font-medium">{justRejectedFilename}</span> {t('ops.upload.rejectedPromptSuffix')}
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setJustRejectedFilename(null)
                  focusChoice()
                }}
              >
                {t('ops.upload.uploadReplacement')}
              </Button>
            </div>
          )}
        </Card>

        {reviewItems.length > 0 && (
          <section>
            <h2 className="mb-3 text-[11px] font-mono uppercase tracking-wide text-amber-800">
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
                  onVisibilityChanged={() => void refresh()}
                />
              ))}
            </div>
          </section>
        )}
      </div>

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
