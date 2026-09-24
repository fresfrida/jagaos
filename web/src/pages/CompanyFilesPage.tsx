/** Every document, filterable by its fixed bucket — the former
 * "Documents" tab, now its own top-level route (2026-09-23, header/nav
 * restructure). The search box that used to live at the top of this tab
 * moved out to its own Search page (per that restructure's explicit
 * mapping); everything else here is unchanged. Reads an optional
 * `?bucket=` query param on load so the Tags landing page's bucket
 * buttons can deep-link straight into a pre-filtered view. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../features/auth/AuthContext'
import { RequireSession } from '../features/auth/RequireSession'
import { roleAtLeast } from '../features/auth/authApi'
import { DocumentResultsList } from '../features/ops/DocumentResultsList'
import { OpsStatusBar } from '../features/ops/OpsStatusBar'
import { VENDOR_NAMES_DATALIST_ID, bucketLabel } from '../features/ops/opsShared'
import { BUCKETS, type Bucket } from '../features/ops/opsApi'
import { useOpsData } from '../features/ops/useOpsData'

function initialBucketFromQuery(): Bucket | null {
  const raw = new URLSearchParams(window.location.search).get('bucket')
  return raw && (BUCKETS as readonly string[]).includes(raw) ? (raw as Bucket) : null
}

function CompanyFilesContent() {
  const { t } = useTranslation()
  const { role } = useAuth()
  const { documents, apiUp, error, refresh } = useOpsData()
  const [activeBucketFilter, setActiveBucketFilter] = useState<Bucket | null>(initialBucketFromQuery)

  const canUpload = role !== null && roleAtLeast(role, 'user')
  const canResolve = role !== null && roleAtLeast(role, 'admin')
  const bucketCounts = Object.fromEntries(
    BUCKETS.map((b) => [b, documents.filter((d) => d.bucket === b).length]),
  ) as Record<Bucket, number>
  const visibleDocuments = activeBucketFilter
    ? documents.filter((d) => d.bucket === activeBucketFilter)
    : documents
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

      <h2 className="mb-3 text-[11px] font-mono uppercase tracking-wide text-muted">
        {t('ops.documents.heading', { count: visibleDocuments.length })}
      </h2>

      {/* Fixed 6-bucket taxonomy (2026-09-22, DECISIONS #42) — not
         user-typed, so this is just BUCKETS, no API call. */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {BUCKETS.map((b) => {
          const active = activeBucketFilter === b
          return (
            <button
              key={b}
              onClick={() => setActiveBucketFilter(active ? null : b)}
              className={`rounded-md px-2 py-0.5 font-mono text-[11px] transition-colors ${active ? 'bg-ink text-white' : 'bg-canvas text-muted hover:text-ink'}`}
            >
              {bucketLabel(t, b)} ({bucketCounts[b]})
            </button>
          )
        })}
      </div>

      <DocumentResultsList
        documents={visibleDocuments}
        canEdit={canUpload}
        canArchive={canResolve}
        onSaved={() => void refresh()}
        emptyMessage={t('ops.documents.noneUploaded')}
      />
    </div>
  )
}

export function CompanyFilesPage() {
  return (
    <RequireSession>
      <CompanyFilesContent />
    </RequireSession>
  )
}
