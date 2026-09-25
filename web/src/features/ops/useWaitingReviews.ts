/** How many review items are waiting, for the signed-in home's Upload card (2026-09-25, round 20,
 * item 2). One fetch of the review queue, no polling: the home is a place people pass through, and
 * the Upload page it links to has the live list. The server already filters the queue by who may see
 * what (viewer: none; user: own uploads; admin and owner: all), so the count is what THIS person
 * would find there.
 *
 * A person's own PRIVATE files (Only me) are left out of both counts: a private file never surfaces
 * outside the Only me section (the peer's privacy rule, round 20), and a number on the home is a
 * surface. They are still confirmed in the review list on the Upload page, as before.
 *
 * `mine` counts what they can resolve themselves (the server's per-item `can_resolve`, else the role);
 * `total` is everything else in their queue. The two differ for a `user` whose own company upload waits
 * for an admin: it is waiting, but not for their review. A failed fetch is 0/0, not an error banner:
 * the count is decoration on a link that works without it. */

import { useEffect, useState } from 'react'
import { roleAtLeast, type Role } from '../auth/authApi'
import { opsApi } from './opsApi'

export interface WaitingReviews {
  mine: number
  total: number
}

export function useWaitingReviews(role: Role | null): WaitingReviews {
  const [counts, setCounts] = useState<WaitingReviews>({ mine: 0, total: 0 })

  useEffect(() => {
    if (role === null) return
    let cancelled = false
    opsApi
      .listReviewItems()
      .then((items) => {
        if (cancelled) return
        const canResolveByRole = roleAtLeast(role, 'admin')
        const company = items.filter((item) => item.document_visibility !== 'only_me')
        setCounts({ mine: company.filter((item) => item.can_resolve ?? canResolveByRole).length, total: company.length })
      })
      .catch(() => {
        if (!cancelled) setCounts({ mine: 0, total: 0 })
      })
    return () => {
      cancelled = true
    }
  }, [role])

  return counts
}
