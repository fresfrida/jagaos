/** Upload a document, watch it land in the review queue, confirm or
 * reject it — the former "Upload & Review" tab, now its own top-level
 * route (2026-09-23, header/nav restructure: promotes each OpsConsole tab
 * to a URL-addressable page). Content moved verbatim from OpsConsole.tsx;
 * data-fetching now comes from the shared useOpsData hook instead of
 * OpsConsole's own state. */

import { Loader2, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { useAuth } from '../features/auth/AuthContext'
import { RequireSession } from '../features/auth/RequireSession'
import { roleAtLeast } from '../features/auth/authApi'
import { normalizeImageForUpload } from '../lib/imageNormalize'
import { onTriggerUploadPicker } from '../lib/uploadTrigger'
import { OpsStatusBar } from '../features/ops/OpsStatusBar'
import { ReviewQueueCard } from '../features/ops/ReviewQueueCard'
import { VENDOR_NAMES_DATALIST_ID } from '../features/ops/opsShared'
import { opsApi } from '../features/ops/opsApi'
import { useOpsData } from '../features/ops/useOpsData'

function UploadReviewContent() {
  const { t } = useTranslation()
  const { role } = useAuth()
  const { documents, reviewItems, apiUp, error, setError, refresh } = useOpsData()

  const [busy, setBusy] = useState(false)
  const [justRejectedFilename, setJustRejectedFilename] = useState<string | null>(null)
  const [isPictureUpload, setIsPictureUpload] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canUpload = role !== null && roleAtLeast(role, 'user')
  const canResolve = role !== null && roleAtLeast(role, 'admin')

  // 2026-09-23 (live regression report, item 5): the bottom nav's raised
  // Upload button (BottomNav.tsx) now dispatches this instead of
  // navigating when already on this page — opens the same file picker
  // the page's own dropzone uses, rather than being a dead tap.
  useEffect(() => {
    if (!canUpload) return
    return onTriggerUploadPicker(() => fileInputRef.current?.click())
  }, [canUpload])
  // 2026-09-22 (DECISIONS #45): vendor_name autocomplete source — distinct
  // values already on this company's documents, no new endpoint.
  const vendorNames = [...new Set(documents.map((d) => d.vendor_name).filter((v): v is string => Boolean(v)))].sort()

  const onUpload = async (file: File) => {
    setBusy(true)
    setError(null)
    setJustRejectedFilename(null)
    try {
      const normalized = await normalizeImageForUpload(file)
      // 2026-09-23 (live regression report, item 3): the result used to
      // be kept and rendered in a "Last upload result" banner — removed
      // outright, the review queue below already communicates the
      // outcome for a needs_review upload. Not read here anymore.
      await opsApi.uploadDocument(normalized, isPictureUpload)
      // 2026-09-23: back to the default (No) after every upload — the
      // common case is still a real document, and leaving Yes stuck on
      // would silently mis-tag the next, unrelated file.
      setIsPictureUpload(false)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

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
          {canUpload && (
            <div className="mb-4">
              {/* 2026-09-23 (DECISIONS #52): the primary human-facing
                 control for the memory/picture case — automatic
                 classification among the other three lanes (statutory/
                 invoice/important) is untouched; this only ever decides
                 "picture, yes or no." Default No — the common case is
                 still a real document. */}
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[13px] text-ink">{t('ops.upload.pictureQuestion')}</span>
                <div className="flex gap-0.5 rounded-control border border-line p-0.5">
                  {([false, true] as const).map((val) => {
                    const active = isPictureUpload === val
                    return (
                      <button
                        key={String(val)}
                        type="button"
                        onClick={() => setIsPictureUpload(val)}
                        className={`rounded-md px-3 py-1 text-[13px] transition-colors ${active ? 'bg-ink text-white' : 'text-muted hover:text-ink'}`}
                      >
                        {val ? t('ops.upload.yes') : t('ops.upload.no')}
                      </button>
                    )
                  })}
                </div>
              </div>
              {isPictureUpload && (
                <p className="mt-1.5 text-[12px] text-muted">
                  {t('ops.upload.pictureWarning')}
                </p>
              )}
            </div>
          )}

          {canUpload ? (
            <label className="flex h-24 cursor-pointer items-center justify-center gap-2 rounded-card border border-dashed border-line text-sm text-muted hover:border-ink/40">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {busy ? t('ops.upload.uploading') : t('ops.upload.clickToUpload')}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void onUpload(file)
                  e.target.value = ''
                }}
              />
            </label>
          ) : (
            <p className="flex h-24 items-center justify-center rounded-card border border-dashed border-line text-sm text-muted">
              {t('ops.upload.viewerCantUpload')}
            </p>
          )}

          {/* 2026-09-23 (DECISIONS #50): closes the loop after a reject
             — it used to just disappear from the queue with no
             indication of where it went or what to do next. Simple
             inline prompt, not a modal — "Upload a replacement" opens
             the file picker directly rather than just scrolling to it. */}
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
                  fileInputRef.current?.click()
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
                  canResolve={canResolve}
                  onResolved={() => void refresh()}
                  onRejected={setJustRejectedFilename}
                  onPoll={() => void refresh()}
                />
              ))}
            </div>
          </section>
        )}
      </div>
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
