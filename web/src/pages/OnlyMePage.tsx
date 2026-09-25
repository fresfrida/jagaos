/** Only me: the person's private space (2026-09-25, round 19, DECISIONS #94), /only-me.
 *
 * Everything uploaded here is a personal file: visible to the uploader and nobody else,
 * for every role, no exception (auth.may_see_document, unchanged). It replaces the old
 * per-file lock toggle: a file is private by being uploaded HERE, and private files no
 * longer appear in Company Files, Search or the Calendar at all (they used to be listed
 * inline for their uploader with a lock).
 *
 * Round 21 (A3, DECISIONS #101): a personal file is NAMED BY ITS OWNER and filed on the spot. Choosing a file (or a
 * scratchpad note, or several photos) opens one small form, a name (required) and a caption (optional), and saving sends it;
 * the server files it at once with no pipeline, no model, no review. The person's files are PersonalFileCards (thumbnail,
 * name, caption, upload date, View / Edit / Delete and nothing else), not Company Files' cards. Delete is FOR GOOD after the
 * person types the file's name (round 20, DECISIONS #99), so it frees one of the 15 slots.
 *
 * Composition only: the same Document / Photo upload area as the Upload page
 * (UploadPanel, a flow that sends every upload as only_me), the person's files (PersonalFileList), and
 * this section's own search box and a bare scratchpad (features/personal/Scratchpad.tsx: draw,
 * clear, save; a save is uploaded as a private image like any Photo). The search filters the loaded list in the browser as they
 * type (features/personal/personalSearch.ts): it never touches the company search.
 *
 * Who: everyone signed in (round 20, final ruling of item 2). User and above get the whole page.
 * A viewer cannot upload, so for them it is the read-only variant: the same heading, the privacy note and
 * the list (empty unless the person was demoted from a role that could upload), with no upload rows, no
 * scratchpad and no Delete. It is a viewer's signed-in home, rendered at `/` by Page.tsx (and at /only-me),
 * never a redirect. An OLD private file still waiting in the review queue (rounds 19 and 20 sent them
 * through it) is confirmed there as before and shows here like any other. */

import { Lock, PenLine, Search, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Toast, useToast } from '../components/ui/Toast'
import { useAuth } from '../features/auth/AuthContext'
import { RequireSession } from '../features/auth/RequireSession'
import { roleAtLeast } from '../features/auth/authApi'
import { type UploadResult } from '../features/ops/opsApi'
import { PersonalDetailsSheet } from '../features/personal/PersonalDetailsSheet'
import { PersonalFileList } from '../features/personal/PersonalFileList'
import { filterPersonalFiles } from '../features/personal/personalSearch'
import { Scratchpad } from '../features/personal/Scratchpad'
import { usePersonalFiles } from '../features/personal/usePersonalFiles'
import { usePersonalLimits } from '../features/personal/usePersonalLimits'
import { UploadPanel } from '../features/upload/UploadPanel'
import { ChoiceRow } from '../features/upload/UploadChoice'
import { uploadErrorMessage } from '../features/upload/uploadErrorMessage'
import { useUploadFlow } from '../features/upload/useUploadFlow'

function OnlyMeContent() {
  const { t, i18n } = useTranslation()
  const { role } = useAuth()
  const canUpload = role !== null && roleAtLeast(role, 'user')
  const personal = usePersonalFiles(role !== null)
  const personalLimits = usePersonalLimits(canUpload)
  const { toast, showToast, dismissToast } = useToast()
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [padOpen, setPadOpen] = useState(false)

  const onOutcome = useCallback(
    (result: UploadResult) => {
      if (result.status === 'duplicate') showToast(t('ops.upload.toast.duplicate'), 'warning')
      else if (result.status === 'quarantined') showToast(t('onlyMe.toast.quarantined'), 'warning')
      else showToast(t('onlyMe.toast.saved'), 'success')
    },
    [showToast, t],
  )
  // After an upload or a delete, both the list and "you have N of 15" are re-read, so neither is stale.
  const { refresh: refreshFiles } = personal
  const { refresh: refreshLimits } = personalLimits
  const refreshAll = useCallback(async () => {
    await Promise.all([refreshFiles(), refreshLimits()])
  }, [refreshFiles, refreshLimits])
  const onError = useCallback(
    (message: string | null, error?: unknown) => setUploadError(message === null ? null : uploadErrorMessage(t, message, error)),
    [t],
  )
  const flow = useUploadFlow({ language: i18n.language, refresh: refreshAll, onOutcome, onError, visibility: 'only_me' })
  const limits = personalLimits.limits
  const atLimit = limits !== null && limits.personal_files_used >= limits.max_personal_files

  const files = personal.state.status === 'ready' ? personal.state.files : []
  const shown = useMemo(() => filterPersonalFiles(files, query), [files, query])
  const searching = query.trim() !== ''

  return (
    <div>
      <p className="mb-4 flex items-start gap-2 text-[14px] leading-5 text-muted">
        <Lock size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span>{t('onlyMe.intro')}</span>
      </p>

      {uploadError && (
        <div className="mb-4 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {uploadError}
        </div>
      )}

      {canUpload && (
        <>
        <Card className="p-6" interactive={false}>
          <UploadPanel flow={flow} disabled={atLimit} personal />
          <p className="mt-4 text-[13px] leading-5 text-muted">{t('onlyMe.namingHint')}</p>
          {limits !== null && (
            <p
              className={`mt-2 text-[13px] leading-5 ${atLimit ? 'font-medium text-ink' : 'text-muted'}`}
              data-testid="only-me-limits-note"
              role="status"
            >
              {atLimit
                ? t('onlyMe.limit.reached', { limit: limits.max_personal_files })
                : t('onlyMe.limits', { max: limits.max_personal_files, mb: Math.round(limits.max_file_bytes / (1024 * 1024)), used: limits.personal_files_used })}
            </p>
          )}
        </Card>

        <Card className={padOpen ? 'mt-4 p-4' : 'mt-4 p-6'} interactive={false}>
          {padOpen ? (
            <Scratchpad onSave={flow.uploadPhoto} busy={flow.busy || atLimit} onClose={() => setPadOpen(false)} />
          ) : (
            <ChoiceRow icon={PenLine} title={t('onlyMe.scratchpad.title')} hint={t('onlyMe.scratchpad.rowHint')} disabled={flow.busy || atLimit} onClick={() => setPadOpen(true)} />
          )}
        </Card>
        </>
      )}

      <section className="mt-8" aria-labelledby="only-me-files-heading">
        <h2 id="only-me-files-heading" className="mb-3 text-[12px] font-mono uppercase tracking-wide text-muted">
          {t('onlyMe.filesHeading', { count: personal.state.status === 'ready' ? files.length : 0 })}
        </h2>

        {personal.state.status === 'loading' && <p className="text-[14px] text-muted" role="status">{t('onlyMe.loading')}</p>}
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
                  className="h-10 w-full rounded-control border border-line bg-white pl-9 pr-9 text-[15px] text-ink outline-none focus:border-ink [&::-webkit-search-cancel-button]:hidden"
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
              <p className="mb-2 text-[13px] text-muted" role="status" data-testid="only-me-search-count">
                {t('onlyMe.searchCount', { shown: shown.length, total: files.length })}
              </p>
            )}
            <PersonalFileList
              documents={shown}
              canEdit={canUpload}
              onChanged={() => void refreshAll()}
              emptyMessage={searching ? t('onlyMe.noMatches', { query: query.trim() }) : t(canUpload ? 'onlyMe.empty' : 'onlyMe.emptyViewer')}
            />
          </>
        )}
      </section>

      <PersonalDetailsSheet draft={flow.draft} onSave={(details) => void flow.saveDraft(details)} onCancel={flow.cancelDraft} />
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
