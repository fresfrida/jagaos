/** Edit-form state for a document's description, kept in step with the
 * selected UI language (2026-09-24, round 10). document.description is a
 * per-language JSON blob (opsShared.tsx's descriptionFor), so the text an
 * edit field should show changes when the language selector does — but a
 * plain useState(initial) only reads the language current at mount.
 *
 * Until the user has typed or dictated something themselves, the field
 * follows the language (and any refreshed server value, e.g. a caption
 * landing late); once they have, it never clobbers their text. "Edited" is
 * tracked explicitly rather than inferred from the field being non-empty,
 * which it always is once a description exists (the bug this replaced).
 *
 * Shared by ReviewQueueCard and DocumentCard so the two cannot drift again
 * — they had, once. `resetDescription` is for DocumentCard, whose card
 * outlives a save/cancel (ReviewQueueCard's disappears on resolve): call it
 * when (re)entering edit mode so a previous edit does not pin stale text. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { descriptionFor } from './opsShared'

export function useEditableDescription(raw: string | null) {
  const { i18n } = useTranslation()
  const [description, setDescriptionState] = useState(() => descriptionFor(raw, i18n.language))
  const editedRef = useRef(false)

  useEffect(() => {
    if (editedRef.current) return
    // null = a picture still waiting for its caption; leave the field alone
    // rather than blanking something the reviewer may already be typing.
    if (raw === null) return
    setDescriptionState(descriptionFor(raw, i18n.language))
  }, [raw, i18n.language])

  const setDescription = useCallback((text: string) => {
    editedRef.current = true
    setDescriptionState(text)
  }, [])

  const resetDescription = useCallback(() => {
    editedRef.current = false
    setDescriptionState(descriptionFor(raw, i18n.language))
  }, [raw, i18n.language])

  return { description, setDescription, resetDescription }
}
