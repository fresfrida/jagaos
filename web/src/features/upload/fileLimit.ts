/** The per-file upload limit, checked in the browser before anything is sent (2026-09-25, round 20, item 6,
 * DECISIONS #99). The server enforces it (413), but a browser that is still sending a 200 MB body when the
 * server answers can lose the answer and show only "Failed to fetch", so the page checks first and says why.
 *
 * The number comes from the server (GET /api/limits), once per page load, so the words and the rule cannot
 * drift apart. A backend without the endpoint, or a failed fetch, means no limit is known and nothing is
 * refused here (the server is still the rule). */

import { ApiError } from '../../lib/apiClient'
import { opsApi } from '../ops/opsApi'

let cached: Promise<number | null> | null = null

export function maxFileBytes(): Promise<number | null> {
  if (cached === null) {
    cached = (async () => {
      try {
        return (await opsApi.getLimits()).max_file_bytes
      } catch {
        cached = null // try again next time rather than remember a failure
        return null
      }
    })()
  }
  return cached
}

/** For tests: forget the remembered limit. */
export function resetFileLimitCache(): void {
  cached = null
}

/** Throws the same ApiError the server would (413, `file_too_large`) when any file is over the limit. */
export async function assertWithinFileLimit(files: readonly File[]): Promise<void> {
  const limit = await maxFileBytes()
  if (limit === null) return
  if (files.some((file) => file.size > limit)) {
    throw new ApiError(413, 'That file is larger than the limit.', 'file_too_large', { code: 'file_too_large', limit_bytes: limit })
  }
}
