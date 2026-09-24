/** The lock toggle's state and its one side effect (2026-09-24, round 14,
 * DECISIONS #86): flip a document between "company" and "only_me" with a single
 * PATCH. Kept out of the presentational VisibilityToggle so the component only
 * draws what it is handed.
 *
 * `initial` is the document's current visibility from the list the card came
 * from; the hook follows it when a refreshed list changes it, and updates
 * itself the moment the server accepts a change (then calls `onChanged` so the
 * list refetches). A refused change (403: not the uploader) leaves the state
 * as it was and reports a translatable message. */

import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../../lib/apiClient'
import { opsApi, type Visibility } from './opsApi'

export function useDocumentVisibility(documentId: number, initial: Visibility, onChanged: () => void) {
  const [visibility, setVisibility] = useState<Visibility>(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'uploaderOnly' | string | null>(null)

  useEffect(() => setVisibility(initial), [initial])

  const toggle = useCallback(async () => {
    const next: Visibility = visibility === 'only_me' ? 'company' : 'only_me'
    setBusy(true)
    setError(null)
    try {
      await opsApi.editDocument(documentId, { visibility: next })
      setVisibility(next)
      onChanged()
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? 'uploaderOnly' : e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [documentId, onChanged, visibility])

  return { visibility, busy, error, toggle }
}
