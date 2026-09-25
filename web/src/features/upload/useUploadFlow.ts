/** What happens between choosing files and the review queue (2026-09-24, round
 * 12, DECISIONS #78): the side effects (client-side photo cleanup, the upload
 * calls, refetching the page's data) and the staged-pages state, pulled out of
 * UploadPage so the page just composes. The pure decisions — what a selection
 * means, how pages reorder — are in uploadSelection.ts. */

import { useCallback, useRef, useState } from 'react'
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

/** A personal file that has been chosen and is waiting for its name (round 21, A3, DECISIONS #101). Nothing is sent until the person
 * gives a name; `files` is one file, or the ordered pages of one document. */
export interface PersonalDraft {
  files: File[]
  isPicture: boolean
  /** The name offered first: the file's own name without its extension, so saving is one tap. */
  defaultName: string
}

/** What the person typed for a personal file: the name is required, the caption is not. */
export interface PersonalDetails {
  name: string
  caption?: string
}

/** A file's name without its extension, cut to a sensible length. */
export function defaultPersonalName(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, '').trim().slice(0, 120) || filename
}

/** What useUploadFlow returns, for the components that render it (UploadPanel). */
export type UploadFlow = ReturnType<typeof useUploadFlow>

export function useUploadFlow({ language, refresh, onOutcome, onError, docTypeHint, visibility }: Deps) {
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState<Uploading | null>(null)
  const [staged, setStaged] = useState<File[] | null>(null)
  const [selectionError, setSelectionError] = useState<SelectionError | null>(null)
  // Only me (round 21, A3): a chosen file waits here for its name instead of being sent, and whoever asked for the upload
  // (the picker, the page stager, the scratchpad) is answered when it has been sent, or has been cancelled.
  const personal = visibility === 'only_me'
  const [draft, setDraft] = useState<PersonalDraft | null>(null)
  const settle = useRef<((sent: boolean) => void) | null>(null)

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

  const sendOne = useCallback(
    (file: File, isPicture: boolean, details?: PersonalDetails) =>
      run(
        async () => {
          // A photo is downscaled first, so a 30 MB phone photo is judged as the small file it becomes.
          const prepared = await normalizeImageForUpload(file)
          await assertWithinFileLimit([prepared])
          return opsApi.uploadDocument(prepared, isPicture, language, {
            docTypeHint: isPicture ? null : docTypeHint,
            visibility,
            ...details,
          })
        },
        { name: details?.name ?? file.name },
      ),
    [docTypeHint, language, run, visibility],
  )

  const sendPages = useCallback(
    (pages: File[], details?: PersonalDetails) =>
      run(
        async () => {
          const prepared = await Promise.all(pages.map(normalizeImageForUpload))
          await assertWithinFileLimit(prepared)
          return opsApi.uploadPages(prepared, language, { docTypeHint, visibility, ...details })
        },
        { name: details?.name ?? pages[0]?.name ?? '', pages: pages.length },
      ),
    [docTypeHint, language, run, visibility],
  )

  /** Only me: hold the file (or pages) for its name. Resolves true once it has been sent, false if the person cancelled. */
  const askForDetails = useCallback(
    (next: PersonalDraft) =>
      new Promise<boolean>((resolve) => {
        settle.current?.(false) // a newer choice replaces one that was never named
        settle.current = resolve
        setDraft(next)
      }),
    [],
  )

  const uploadOne = useCallback(
    (file: File, isPicture: boolean) =>
      personal
        ? askForDetails({ files: [file], isPicture, defaultName: defaultPersonalName(file.name) })
        : sendOne(file, isPicture),
    [askForDetails, personal, sendOne],
  )

  /** The person named the held file: close the sheet at once (the page shows the progress) and send it. */
  const saveDraft = useCallback(
    async (details: PersonalDetails) => {
      if (!draft) return
      const answer = settle.current
      settle.current = null
      setDraft(null)
      const sent = draft.files.length === 1 ? await sendOne(draft.files[0]!, draft.isPicture, details) : await sendPages(draft.files, details)
      answer?.(sent)
    },
    [draft, sendOne, sendPages],
  )

  const cancelDraft = useCallback(() => {
    const answer = settle.current
    settle.current = null
    setDraft(null)
    answer?.(false)
  }, [])

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
        : personal
          ? await askForDetails({ files: staged, isPicture: false, defaultName: defaultPersonalName(only.name) })
          : await sendPages(staged)
    if (done) cancelStaging()
  }, [askForDetails, cancelStaging, personal, sendPages, staged, uploadOne])

  return {
    busy, uploading, staged, selectionError, draft,
    uploadPhoto, chooseDocumentFiles, addPages, move, remove, cancelStaging, submitPages, saveDraft, cancelDraft,
  }
}
