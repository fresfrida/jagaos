/** What to show for a failed upload (2026-09-25, round 20, item 6, DECISIONS #99): the backend's English text is
 * kept for anything unexpected, but the two rules this round added are translated by their code, with the number
 * that was hit, so a Malay page never shows an English sentence for them. */

import type { TFunction } from 'i18next'
import { ApiError } from '../../lib/apiClient'

const MEGABYTE = 1024 * 1024

export function uploadErrorMessage(t: TFunction, message: string, error?: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'file_too_large') {
      const bytes = typeof error.data?.limit_bytes === 'number' ? error.data.limit_bytes : 25 * MEGABYTE
      return t('ops.upload.error.fileTooLarge', { mb: Math.round(bytes / MEGABYTE) })
    }
    if (error.code === 'personal_file_limit') {
      return t('onlyMe.limit.reached', { limit: typeof error.data?.limit === 'number' ? error.data.limit : 15 })
    }
  }
  return message
}
