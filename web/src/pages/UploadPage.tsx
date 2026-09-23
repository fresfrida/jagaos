/** Upload a document, watch it land in the review queue, confirm or
 * reject it — the former "Upload & Review" tab, now its own top-level
 * route (2026-09-23, header/nav restructure: promotes each OpsConsole tab
 * to a URL-addressable page). Content moved verbatim from OpsConsole.tsx;
 * data-fetching now comes from the shared useOpsData hook instead of
 * OpsConsole's own state. */

import { Loader2, ShieldAlert, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { useAuth } from '../features/auth/AuthContext'
import { RequireSession } from '../features/auth/RequireSession'
import { roleAtLeast } from '../features/auth/authApi'
import { normalizeImageForUpload } from '../lib/imageNormalize'
import { OpsStatusBar } from '../features/ops/OpsStatusBar'
import { ReviewQueueCard } from '../features/ops/ReviewQueueCard'
import { StatusPill, VENDOR_NAMES_DATALIST_ID } from '../features/ops/opsShared'
import { opsApi, type UploadResult } from '../features/ops/opsApi'
import { useOpsData } from '../features/ops/useOpsData'

function UploadReviewContent() {
  const { t } = useTranslation()
  const { role } = useAuth()
  const { documents, reviewItems, apiUp, error, setError, refresh } = useOpsData()

  const [busy, setBusy] = useState(false)
  const [lastUpload, setLastUpload] = useState<UploadResult | null>(null)
  const [justRejectedFilename, setJustRejectedFilename] = useState<string | null>(null)
  const [isPictureUpload, setIsPictureUpload] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const canUpload = role !== null && roleAtLeast(role, 'user')
  const canResolve = role !== null && roleAtLeast(role, 'admin')
  // 2026-09-22 (DECISIONS #47): same routine-vs-flagged distinction
  // ReviewQueueCard already makes (isRoutine, DECISIONS #40) — a clean
  // upload's badge shouldn't read as "something's wrong" here either.
  const isRoutineUpload = lastUpload?.status === 'needs_review' && lastUpload.review?.reason === 'clean extraction'
  // 2026-09-22 (DECISIONS #45): vendor_name autocomplete source — distinct
  // values already on this company's documents, no new endpoint.
  const vendorNames = [...new Set(documents.map((d) => d.vendor_name).filter((v): v is string => Boolean(v)))].sort()

  const onUpload = async (file: File) => {
    setBusy(true)
    setError(null)
    setJustRejectedFilename(null)
    try {
      const normalized = await normalizeImageForUpload(file)
      const result = await opsApi.uploadDocument(normalized, isPictureUpload)
      setLastUpload(result)
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

          {lastUpload && (
            <div className="mt-4 rounded-card border border-line bg-canvas p-4 text-[13px]">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink">{t('ops.upload.lastResult')}</span>
                {!isRoutineUpload && <StatusPill status={lastUpload.status} />}
              </div>
              {lastUpload.classify && (
                <p className="mt-1 text-muted">
                  {/* This is classification confidence ("this looks like an
                     invoice"), not extraction accuracy — scoping the label
                     to document-type detection so it doesn't read as a
                     blanket trust score on the extracted fields (2026-09-22). */}
                  {t('ops.upload.classifiedAs', {
                    lane: lastUpload.classify.lane,
                    docType: lastUpload.classify.doc_type,
                    confidence: (lastUpload.classify.confidence * 100).toFixed(0),
                  })}
                  {lastUpload.classify.injection_suspected && (
                    <span className="ml-2 inline-flex items-center gap-1 text-red-700">
                      <ShieldAlert size={12} /> {t('ops.upload.injectionSuspected')}
                    </span>
                  )}
                </p>
              )}
              {lastUpload.status === 'needs_review' && lastUpload.review?.question && (
                <p className="mt-1 text-amber-800">{t('ops.upload.reviewLabel', { question: lastUpload.review.question })}</p>
              )}
              {lastUpload.status === 'quarantined' && (
                <p className="mt-1 text-red-700">{t('ops.upload.quarantinedMessage')}</p>
              )}
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
