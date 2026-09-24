/** What happens between choosing files and the review queue (2026-09-24, round
 * 12, DECISIONS #78): the side effects (client-side photo cleanup, the upload
 * calls, refetching the page's data) and the staged-pages state, pulled out of
 * UploadPage so the page just composes. The pure decisions — what a selection
 * means, how pages reorder — are in uploadSelection.ts. */

import { useCallback, useState } from 'react'
import { normalizeImageForUpload } from '../../lib/imageNormalize'
import { opsApi, type UploadResult } from '../ops/opsApi'
import {
  appendPages, interpretDocumentSelection, movePage, removePage, type SelectionError,
} from './uploadSelection'

interface Deps {
  /** The uploader's selected UI language — classify.py writes the description in it. */
  language: string
  refresh: () => Promise<void>
  /** Called with the server's answer for each finished upload (drives the toast). */
  onOutcome: (result: UploadResult) => void
  /** null clears the page's error banner; a string shows it. */
  onError: (message: string | null) => void
}

export function useUploadFlow({ language, refresh, onOutcome, onError }: Deps) {
  const [busy, setBusy] = useState(false)
  const [staged, setStaged] = useState<File[] | null>(null)
  const [selectionError, setSelectionError] = useState<SelectionError | null>(null)

  const run = useCallback(
    async (send: () => Promise<UploadResult>): Promise<boolean> => {
      setBusy(true)
      onError(null)
      try {
        const result = await send()
        await refresh()
        onOutcome(result)
        return true
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e))
        return false
      } finally {
        setBusy(false)
      }
    },
    [onError, onOutcome, refresh],
  )

  const uploadOne = useCallback(
    (file: File, isPicture: boolean) =>
      run(async () => opsApi.uploadDocument(await normalizeImageForUpload(file), isPicture, language)),
    [language, run],
  )

  /** PHOTO: exactly one image, marked as a picture. */
  const uploadPhoto = useCallback((file: File) => void uploadOne(file, true), [uploadOne])

  /** DOCUMENT: one file uploads at once; several photos are staged as pages. */
  const chooseDocumentFiles = useCallback(
    (files: File[]) => {
      setSelectionError(null)
      const selection = interpretDocumentSelection(files)
      if (selection.kind === 'single') void uploadOne(selection.file, false)
      else if (selection.kind === 'pages') setStaged(selection.files)
      else if (selection.kind === 'error') setSelectionError(selection.error)
    },
    [uploadOne],
  )

  const addPages = useCallback((added: File[]) => {
    setStaged((current) => {
      const result = appendPages(current ?? [], added)
      setSelectionError(result.error)
      return result.files
    })
  }, [])

  const move = useCallback((index: number, delta: number) => setStaged((c) => (c ? movePage(c, index, delta) : c)), [])
  const remove = useCallback((index: number) => setStaged((c) => (c ? removePage(c, index) : c)), [])
  const cancelStaging = useCallback(() => {
    setStaged(null)
    setSelectionError(null)
  }, [])

  const submitPages = useCallback(async () => {
    const [only] = staged ?? []
    if (!staged || only === undefined) return
    const done =
      staged.length === 1
        ? await uploadOne(only, false) // took pages away until one was left: an ordinary upload
        : await run(async () => {
            const pages = await Promise.all(staged.map(normalizeImageForUpload))
            return opsApi.uploadPages(pages, language)
          })
    if (done) cancelStaging()
  }, [cancelStaging, language, run, staged, uploadOne])

  return {
    busy, staged, selectionError,
    uploadPhoto, chooseDocumentFiles, addPages, move, remove, cancelStaging, submitPages,
  }
}
