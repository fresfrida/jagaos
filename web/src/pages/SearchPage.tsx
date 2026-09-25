/** Real, session-scoped full-text search over this company's documents —
 * the search box that used to sit at the top of the Documents tab,
 * promoted to its own top-level route (2026-09-23, header/nav
 * restructure, explicit mapping: "Search → the search box currently
 * embedded in the Documents tab, promoted to its own page"). Not the same
 * thing as features/search/'s mock preview on the logged-out marketing
 * pages (no session there to call this with) — this hits the real
 * GET /api/search. Deliberately doesn't use useOpsData: this page has no
 * need for the bulk documents/expectations/obligations/reviewItems fetch
 * the other ops pages share, only whatever a search actually returns.
 *
 * Round 21 (A8, DECISIONS #101): before anything is searched, the page shows a word cloud of what the company's documents
 * talk about (features/search/WordCloud.tsx); a word is a button that runs that search. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { useAuth } from '../features/auth/AuthContext'
import { RequireSession } from '../features/auth/RequireSession'
import { roleAtLeast } from '../features/auth/authApi'
import { DocumentResultsList } from '../features/ops/DocumentResultsList'
import { OpsStatusBar } from '../features/ops/OpsStatusBar'
import { VENDOR_NAMES_DATALIST_ID } from '../features/ops/opsShared'
import { opsApi, type DocumentRow } from '../features/ops/opsApi'
import { useSearchTerms } from '../features/search/useSearchTerms'
import { WordCloud } from '../features/search/WordCloud'

function SearchContent() {
  const { t } = useTranslation()
  const { role } = useAuth()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DocumentRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cloud = useSearchTerms(true)

  const canUpload = role !== null && roleAtLeast(role, 'user')
  const canResolve = role !== null && roleAtLeast(role, 'admin')
  // Autocomplete scoped to the current result set rather than every
  // document the company has — this page has no reason to fetch the full
  // list just for one dropdown (see this file's docstring).
  const vendorNames = [...new Set((results ?? []).map((d) => d.vendor_name).filter((v): v is string => Boolean(v)))].sort()

  const runSearch = async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed) {
      setResults(null)
      return
    }
    try {
      setResults(await opsApi.search(trimmed))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div>
      <OpsStatusBar />
      <datalist id={VENDOR_NAMES_DATALIST_ID}>
        {vendorNames.map((v) => <option key={v} value={v} />)}
      </datalist>

      {error && (
        <div className="mb-4 rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void runSearch(query)
        }}
        className="mb-4 flex gap-2"
      >
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (!e.target.value.trim()) setResults(null)
          }}
          placeholder={t('ops.documents.searchPlaceholder')}
          className="h-9 flex-1 rounded-control border border-line px-2.5 text-[14px] text-ink outline-none focus:border-ink"
        />
        {results !== null && (
          <Button
            size="sm"
            variant="secondary"
            type="button"
            onClick={() => {
              setQuery('')
              setResults(null)
            }}
          >
            {t('common.buttons.clear')}
          </Button>
        )}
      </form>

      {results === null ? (
        <>
          <p className="rounded-card border border-line bg-white p-6 text-sm text-muted">{t('ops.search.prompt')}</p>
          <WordCloud
            state={cloud.state}
            onRetry={cloud.retry}
            onPick={(term) => {
              setQuery(term)
              void runSearch(term)
            }}
          />
        </>
      ) : (
        <DocumentResultsList
          documents={results}
          canEdit={canUpload}
          canArchive={canResolve}
          canRequestPurge={role === 'owner'}
          onSaved={() => void runSearch(query)}
          emptyMessage={t('ops.documents.noMatch')}
        />
      )}
    </div>
  )
}

export function SearchPage() {
  return (
    <RequireSession>
      <SearchContent />
    </RequireSession>
  )
}
