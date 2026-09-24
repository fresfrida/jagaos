/** Only me: the person's private space (2026-09-25, round 19, DECISIONS #94), /only-me.
 *
 * Everything uploaded here is a personal file: visible to the uploader and nobody else,
 * for every role, no exception (auth.may_see_document, unchanged). It replaces the old
 * per-file lock toggle: a file is private by being uploaded HERE, and private files no
 * longer appear in Company Files, Search or the Calendar at all (they used to be listed
 * inline for their uploader with a lock).
 *
 * Composition only: the same Document / Photo upload area as the Upload page
 * (UploadPanel, a flow that sends every upload as only_me), the person's files as the
 * same cards Company Files uses (DocumentResultsList, WITH Delete: since round 19,
 * DECISIONS #95, the uploader may archive their own personal file, the one case where a
 * `user` may delete anything), and
 * this section's own search box and a bare scratchpad (features/personal/Scratchpad.tsx: draw,
 * clear, save; a save is uploaded as a private image like any Photo). The search filters the loaded list in the browser as they
 * type (features/personal/personalSearch.ts): it never touches the company search.
 *
 * Who: user and above (a viewer cannot upload, so there is nothing to add; a viewer
 * who opens the address is sent to the Calendar, like Company Settings for a role that
 * has no page there). A new private file is confirmed like any upload, in the review
 * queue on the Upload page, and shows here with its status meanwhile. */

import { Lock, PenLine, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Toast, useToast } from '../components/ui/Toast'
import { useAuth } from '../features/auth/AuthContext'
import { RequireSession } from '../features/auth/RequireSession'
import { roleAtLeast } from '../features/auth/authApi'
import { DocumentResultsList } from '../features/ops/DocumentResultsList'
import { bucketLabel } from '../features/ops/opsShared'
import { type UploadResult } from '../features/ops/opsApi'
import { filterPersonalFiles } from '../features/personal/personalSearch'
import { Scratchpad } from '../features/personal/Scratchpad'
import { usePersonalFiles } from '../features/personal/usePersonalFiles'
import { UploadPanel } from '../features/upload/UploadPanel'
import { ChoiceRow } from '../features/upload/UploadChoice'
import { useUploadFlow } from '../features/upload/useUploadFlow'
import { Link } from '../router/Link'
import { navigate } from '../router/navigate'
import { routeHref } from '../router/routes'

function OnlyMeContent() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const canUpload = role !== null && roleAtLeast(role, 'user')
  const personal = usePersonalFiles(canUpload)
  const { toast, showToast, dismissToast } = useToast()
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [padOpen, setPadOpen] = useState(false)

  useEffect(() => {
    if (role !== null && !canUpload) navigate(routeHref('calendar'))
  }, [role, canUpload])

  const onOutcome = useCallback(
    (result: UploadResult) => {
      if (result.status === 'duplicate') showToast(t('ops.upload.toast.duplicate'), 'warning')
      else if (result.status === 'quarantined') showToast(t('onlyMe.toast.quarantined'), 'warning')
      else showToast(t('onlyMe.toast.saved'), 'success')
    },
    [showToast, t],
  )
  const flow = useUploadFlow({ language: i18n.language, refresh: personal.refresh, onOutcome, onError: setUploadError, visibility: 'only_me' })

  const files = personal.state.status === 'ready' ? personal.state.files : []
  const shown = useMemo(() => filterPersonalFiles(files, query, (b) => bucketLabel(t, b)), [files, query, t])
  const searching = query.trim() !== ''

  if (!canUpload) return <p className="py-16 text-sm text-muted">{t('ops.session.redirecting')}</p>

  return (
    <div>
      <p className="mb-4 flex items-start gap-2 text-[13px] leading-5 text-muted">
        <Lock size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{t('onlyMe.intro')}</span>
      </p>

      {uploadError && (
        <div className="mb-4 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {uploadError}
        </div>
      )}

      <Card className="p-6" interactive={false}>
        <UploadPanel flow={flow} />
        <p className="mt-4 text-[12px] leading-5 text-muted">
          {t('onlyMe.reviewHint')}{' '}
          <Link href={routeHref('upload')} className="text-ink underline underline-offset-2 hover:text-muted">
            {t('onlyMe.reviewLink')}
          </Link>
        </p>
      </Card>

      <Card className={padOpen ? 'mt-4 p-4' : 'mt-4 p-6'} interactive={false}>
        {padOpen ? (
          <Scratchpad onSave={flow.uploadPhoto} busy={flow.busy} onClose={() => setPadOpen(false)} />
        ) : (
          <ChoiceRow icon={PenLine} title={t('onlyMe.scratchpad.title')} hint={t('onlyMe.scratchpad.rowHint')} disabled={flow.busy} onClick={() => setPadOpen(true)} />
        )}
      </Card>

      <section className="mt-8" aria-labelledby="only-me-files-heading">
        <h2 id="only-me-files-heading" className="mb-3 text-[11px] font-mono uppercase tracking-wide text-muted">
          {t('onlyMe.filesHeading', { count: personal.state.status === 'ready' ? files.length : 0 })}
        </h2>

        {personal.state.status === 'loading' && <p className="text-[13px] text-muted" role="status">{t('onlyMe.loading')}</p>}
        {personal.state.status === 'failed' && (
          <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            <p>{t('onlyMe.loadFailed')}</p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={personal.retry}>{t('onlyMe.retry')}</Button>
          </div>
        )}

        {personal.state.status === 'ready' && (
          <>
            {files.length > 0 && (
              <div className="relative mb-4">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setQuery('')
                  }}
                  placeholder={t('onlyMe.searchPlaceholder')}
                  aria-label={t('onlyMe.searchLabel')}
                  className="h-10 w-full rounded-control border border-line bg-white pl-9 pr-9 text-[14px] text-ink outline-none focus:border-ink [&::-webkit-search-cancel-button]:hidden"
                />
                {searching && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label={t('onlyMe.searchClear')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-control p-1 text-muted hover:bg-canvas hover:text-ink"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
            {searching && files.length > 0 && (
              <p className="mb-2 text-[12px] text-muted" role="status" data-testid="only-me-search-count">
                {t('onlyMe.searchCount', { shown: shown.length, total: files.length })}
              </p>
            )}
            <DocumentResultsList
              documents={shown}
              canEdit={canUpload}
              canArchive
              onSaved={() => void personal.refresh()}
              emptyMessage={searching ? t('onlyMe.noMatches', { query: query.trim() }) : t('onlyMe.empty')}
            />
          </>
        )}
      </section>

      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  )
}

export function OnlyMePage() {
  return (
    <RequireSession>
      <OnlyMeContent />
    </RequireSession>
  )
}
