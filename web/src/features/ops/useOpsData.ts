/** The four session-scoped collections every ops page reads from
 * (documents/expectations/obligations/reviewItems), plus the backend
 * health check — lifted verbatim out of the old single-mount OpsConsole
 * (2026-09-23, header/nav restructure: each former tab is now its own
 * route, so this fetch-everything-together behavior moves into a shared
 * hook rather than living in one component). Each page that needs any of
 * this data calls the hook independently — a real, disclosed tradeoff of
 * "separate top-level routes" is that navigating between them re-fetches,
 * where the old single-page tab switcher didn't (see docs/DECISIONS.md). */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { opsApi, type DocumentRow, type Expectation, type Obligation, type ReviewItem } from './opsApi'

export function useOpsData() {
  const { status } = useAuth()
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [expectations, setExpectations] = useState<Expectation[]>([])
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [apiUp, setApiUp] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    opsApi
      .health()
      .then(() => setApiUp(true))
      .catch(() => setApiUp(false))
  }, [])

  const refresh = useCallback(async () => {
    const [docs, exps, obls, reviews] = await Promise.all([
      opsApi.listDocuments(),
      opsApi.listExpectations(),
      opsApi.listObligations(),
      opsApi.listReviewItems(),
    ])
    setDocuments(docs)
    setExpectations(exps)
    setObligations(obls)
    setReviewItems(reviews)
  }, [])

  useEffect(() => {
    if (status !== 'signed-in') return
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [status, refresh])

  const archiveDocument = useCallback(
    async (documentId: number) => {
      try {
        await opsApi.archiveDocument(documentId)
        await refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [refresh],
  )

  return {
    documents,
    expectations,
    obligations,
    reviewItems,
    apiUp,
    error,
    setError,
    refresh,
    archiveDocument,
  }
}
