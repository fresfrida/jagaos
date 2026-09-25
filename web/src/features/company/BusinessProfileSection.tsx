/** The "Business profile" row at the top of Company Settings (2026-09-24, round 16,
 * item 6). This is where a company's business profile lives: it is not listed in
 * Company Files, Search or the Calendar. Same row as the Upload page's DOCUMENT /
 * PHOTO choice (icon, title, one line under); once a profile is uploaded it shows a
 * thumbnail that opens the same lightbox as everywhere else, its state, and the
 * actions that make sense for that state.
 *
 * Presentational. What is loaded, uploaded and removed comes from
 * useBusinessProfile; "fill in the form" is the page's, which owns the form. */

import { ChevronRight, FileText, Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { FileName } from '../../components/ui/FileName'
import { middleEllipsis } from '../../lib/filename'
import { Link } from '../../router/Link'
import { routeHref } from '../../router/routes'
import { DocumentThumbnail, DocumentViewerModal } from '../ops/DocumentCard'
import { ChoiceRow } from '../upload/UploadChoice'
import type { useBusinessProfile } from './useBusinessProfile'

type Profile = ReturnType<typeof useBusinessProfile>

const STATUS_KEYS: Record<string, string> = {
  filed: 'companySettings.businessProfile.status.filed',
  needs_review: 'companySettings.businessProfile.status.needsReview',
  quarantined: 'companySettings.businessProfile.status.quarantined',
}

export function BusinessProfileSection({
  profile,
  onFill,
  fillBusy,
}: {
  profile: Profile
  onFill: (documentId: number) => void
  fillBusy: boolean
}) {
  const { t } = useTranslation()
  const input = useRef<HTMLInputElement>(null)
  const [viewing, setViewing] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const { state, uploading, notice, removing } = profile

  if (state.status === 'unavailable') return null // a backend that predates the endpoint
  const document = state.status === 'ready' ? state.document : null
  const busy = uploading !== null || removing
  const pick = () => input.current?.click()

  return (
    <section aria-labelledby="business-profile-heading" className="mb-6">
      <h2 id="business-profile-heading" className="sr-only">{t('companySettings.businessProfile.title')}</h2>

      {state.status === 'loading' && (
        <p className="py-4 text-[14px] text-muted" role="status">{t('companySettings.businessProfile.loading')}</p>
      )}
      {state.status === 'failed' && (
        <p className="py-4 text-[14px] text-red-700" role="alert">{t('companySettings.businessProfile.loadFailed')}</p>
      )}

      {uploading !== null && (
        <div className="flex items-center gap-4 border-y border-line py-5" role="status">
          <Loader2 size={28} strokeWidth={1.75} className="shrink-0 animate-spin text-ink" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-base font-semibold text-ink">{t('companySettings.businessProfile.uploading')}</span>
            <FileName name={uploading.name} max={30} className="mt-0.5 block text-[14px] text-muted" />
          </span>
        </div>
      )}

      {state.status === 'ready' && uploading === null && document === null && (
        <div className="border-y border-line">
          <ChoiceRow
            icon={FileText}
            title={t('companySettings.businessProfile.title')}
            hint={t('companySettings.businessProfile.hint')}
            disabled={busy}
            onClick={pick}
          />
        </div>
      )}

      {state.status === 'ready' && uploading === null && document !== null && (
        <div className="border-y border-line">
          <div className="flex items-center gap-4 py-4">
            <button
              type="button"
              onClick={() => setViewing(true)}
              aria-label={t('companySettings.businessProfile.view')}
              className="shrink-0 rounded-control outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
            >
              <DocumentThumbnail documentId={document.id} mediaType={document.media_type} />
            </button>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-ink">{t('companySettings.businessProfile.title')}</span>
              <FileName name={document.filename} max={30} className="mt-0.5 block text-[14px] text-muted" />
              <span className="mt-0.5 block text-[13px] text-muted">{t(STATUS_KEYS[document.status] ?? STATUS_KEYS.needs_review ?? '')}</span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-4">
            {document.can_prefill && (
              <Button size="sm" onClick={() => onFill(document.id)} disabled={busy || fillBusy}>
                {t('companySettings.businessProfile.fill')}
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={pick} disabled={busy}>
              {t('companySettings.businessProfile.replace')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirmingRemove(true)} disabled={busy}>
              {t('companySettings.businessProfile.remove')}
            </Button>
            {document.status === 'needs_review' && (
              <Link href={routeHref('upload')} className="text-[14px] text-ink underline underline-offset-2 hover:text-muted">
                {t('companySettings.businessProfile.openQueue')}
              </Link>
            )}
          </div>
        </div>
      )}

      {notice && (
        <p role={notice === 'failed' ? 'alert' : 'status'} className={`mt-2 text-[14px] ${notice === 'failed' ? 'text-red-700' : 'text-muted'}`}>
          {t(`companySettings.businessProfile.notice.${notice}`)}
        </p>
      )}

      <input
        ref={input}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="business-profile-input"
        onChange={(event) => {
          const [file] = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (file) void profile.upload(file)
        }}
      />

      {viewing && document && (
        <DocumentViewerModal doc={{ id: document.id, filename: document.filename, media_type: document.media_type }} onClose={() => setViewing(false)} />
      )}

      <ConfirmDialog
        open={confirmingRemove}
        message={t('companySettings.businessProfile.removeConfirm', { filename: middleEllipsis(document?.filename ?? '', 40) })}
        confirmLabel={t('common.buttons.delete')}
        cancelLabel={t('common.buttons.cancel')}
        busy={removing}
        onConfirm={() => {
          setConfirmingRemove(false)
          if (document) void profile.remove(document.id)
        }}
        onCancel={() => setConfirmingRemove(false)}
      />
    </section>
  )
}
