/** What happens between choosing files and the review queue (2026-09-24, round
 * 12, DECISIONS #78): the side effects (client-side photo cleanup, the upload
 * calls, refetching the page's data) and the staged-pages state, pulled out of
 * UploadPage so the page just composes. The pure decisions — what a selection
 * means, how pages reorder — are in uploadSelection.ts. */

import { useCallback, useState } from 'react'
import { normalizeImageForUpload } from '../../lib/imageNormalize'
import { opsApi, type UploadResult, type Visibility } from '../ops/opsApi'
import { assertWithinFileLimit } from './fileLimit'
import {
  appendPages, interpretDocumentSelection, movePage, removePage, type SelectionError,
} from './uploadSelection'

interface Deps {
  /** The uploader's selected UI language — classify.py writes the description in it. */
  language: string
  refresh: () => Promise<void>
  /** Called with the server's answer for each finished upload (drives the toast). */
  onOutcome: (result: UploadResult) => void
  /** null clears the page's error banner; a string shows it. The error itself comes second, so a page can
   * translate a known reason by its code (uploadErrorMessage.ts). */
  onError: (message: string | null, error?: unknown) => void
  /** The checklist item this upload was started from (round 16, DECISIONS #90): a
   * doc_type slug sent to classify as a hint. Applies to documents, not photos. */
  docTypeHint?: string | null
  /** 'only_me' when this flow serves the "Only me" section (round 19, DECISIONS #94):
   * every upload it makes is a personal file. Omitted means the company's. */
  visibility?: Visibility
}

/** What is being sent right now, for the progress moment. */
export interface Uploading {
  name: string
  /** Set when several photos are merged into one document. */
  pages?: number
}

/** What useUploadFlow returns, for the components that render it (UploadPanel). */
export type UploadFlow = ReturnType<typeof useUploadFlow>

export function useUploadFlow({ language, refresh, onOutcome, onError, docTypeHint, visibility }: Deps) {
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState<Uploading | null>(null)
  const [staged, setStaged] = useState<File[] | null>(null)
  const [selectionError, setSelectionError] = useState<SelectionError | null>(null)

  const run = useCallback(
    async (send: () => Promise<UploadResult>, what: Uploading): Promise<boolean> => {
      setBusy(true)
      setUploading(what)
      onError(null)
      try {
        const result = await send()
        await refresh()
        onOutcome(result)
        return true
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e), e)
        return false
      } finally {
        setBusy(false)
        setUploading(null)
      }
    },
    [onError, onOutcome, refresh],
  )

  const uploadOne = useCallback(
    (file: File, isPicture: boolean) =>
      run(
        async () => {
          // A photo is downscaled first, so a 30 MB phone photo is judged as the small file it becomes.
          const prepared = await normalizeImageForUpload(file)
          await assertWithinFileLimit([prepared])
          return opsApi.uploadDocument(prepared, isPicture, language, {
            docTypeHint: isPicture ? null : docTypeHint,
            visibility,
          })
        },
        { name: file.name },
      ),
    [docTypeHint, language, run, visibility],
  )

  /** PHOTO: exactly one image, marked as a picture. Resolves true when it was sent
   * (the Only me scratchpad clears itself only then). */
  const uploadPhoto = useCallback((file: File) => uploadOne(file, true), [uploadOne])

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
        : await run(
            async () => {
              const pages = await Promise.all(staged.map(normalizeImageForUpload))
              await assertWithinFileLimit(pages)
              return opsApi.uploadPages(pages, language, { docTypeHint, visibility })
            },
            { name: only.name, pages: staged.length },
          )
    if (done) cancelStaging()
  }, [cancelStaging, docTypeHint, language, run, staged, uploadOne, visibility])

  return {
    busy, uploading, staged, selectionError,
    uploadPhoto, chooseDocumentFiles, addPages, move, remove, cancelStaging, submitPages,
  }
}
