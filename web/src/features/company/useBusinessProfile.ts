/** The Company Settings "Business profile" section's data and actions (2026-09-24,
 * round 16, DECISIONS #90): which document is the company's current business
 * profile, uploading a new one, removing it. All the side effects live here so
 * BusinessProfileSection stays presentational.
 *
 * The upload is the ordinary one (POST /api/documents): the file goes through the
 * real pipeline, classify and extract included, and lands in the review queue like
 * any document. This hook does not confirm it for the owner; a person still checks
 * what was read, in the queue, and only then can the settings form be filled from it.
 *
 * Skew: the frontend deploys on every push and the backend only when redeployed, so
 * a backend without GET /api/business-profile answers 404. That is `unavailable`
 * and the section is not shown, rather than offering an upload whose result the
 * page could never display. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/apiClient'
import { authApi, type BusinessProfileDocument } from '../auth/authApi'
import { opsApi } from '../ops/opsApi'

export type BusinessProfileState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'failed' }
  | { status: 'ready'; document: BusinessProfileDocument | null }

/** What the last upload amounted to, for a line under the row. */
export type UploadNotice = 'uploaded' | 'notAProfile' | 'duplicate' | 'quarantined' | 'failed'

export function useBusinessProfile({ enabled, language }: { enabled: boolean; language: string }) {
  const [state, setState] = useState<BusinessProfileState>({ status: 'loading' })
  const [uploading, setUploading] = useState<{ name: string } | null>(null)
  const [notice, setNotice] = useState<UploadNotice | null>(null)
  const [removing, setRemoving] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async (): Promise<BusinessProfileDocument | null | undefined> => {
    try {
      const { document } = await authApi.getBusinessProfile()
      if (mounted.current) setState({ status: 'ready', document })
      return document
    } catch (e) {
      if (mounted.current) setState(e instanceof ApiError && (e.status === 404 || e.status === 403) ? { status: 'unavailable' } : { status: 'failed' })
      return undefined
    }
  }, [])

  useEffect(() => {
    if (enabled) void load()
  }, [enabled, load])

  const upload = useCallback(
    async (file: File) => {
      setUploading({ name: file.name })
      setNotice(null)
      try {
        const result = await opsApi.uploadDocument(file, false, language)
        if (result.status === 'duplicate') {
          await load()
          if (mounted.current) setNotice('duplicate')
        } else if (result.status === 'quarantined') {
          await load()
          if (mounted.current) setNotice('quarantined')
        } else {
          // The classifier decides what the file is. If it is not a business profile it
          // was filed with the other documents and will not show here; say so.
          const current = await load()
          if (mounted.current) setNotice(current && current.id === result.document_id ? 'uploaded' : 'notAProfile')
        }
      } catch {
        if (mounted.current) setNotice('failed')
      } finally {
        if (mounted.current) setUploading(null)
      }
    },
    [language, load],
  )

  const remove = useCallback(
    async (documentId: number) => {
      setRemoving(true)
      setNotice(null)
      try {
        await opsApi.archiveDocument(documentId)
        await load()
      } catch {
        if (mounted.current) setNotice('failed')
      } finally {
        if (mounted.current) setRemoving(false)
      }
    },
    [load],
  )

  return { state, uploading, notice, removing, upload, remove, reload: load }
}
