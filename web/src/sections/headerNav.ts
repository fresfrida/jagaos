/** What the signed-in header shows to whom (2026-09-24, round 14, DECISIONS
 * #88) — pure role rules, kept out of the components so they are testable and
 * the header itself stays layout. The role checks mirror the server's
 * (app/auth.py); they decide what is OFFERED, not what is allowed. */

import { roleAtLeast, type Role } from '../features/auth/authApi'
import { ACCOUNT_MENU_ROUTES, type RouteId } from '../router/routes'

/** The pages listed in the account menu for this role: Tags and Search for
 * everyone, then Company Settings for admin and owner. Admin sees the page
 * read-only, so the entry is theirs too (the same call DECISIONS #64 made;
 * the fields stay owner-only editable, enforced in CompanySettingsPage and the
 * backend). A role of null (still loading) gets the common two. */
export function accountMenuRoutes(role: Role | null): readonly RouteId[] {
  return [...ACCOUNT_MENU_ROUTES, ...(role !== null && roleAtLeast(role, 'admin') ? (['company-settings'] as const) : [])]
}

/** Whether the header offers the Upload button. A viewer is refused by the
 * server (POST /api/documents needs `user`), so the button should not exist
 * for them: with no Get Started when signed in, their header simply has no
 * button. */
export function canOfferUpload(role: Role | null): boolean {
  return role !== null && roleAtLeast(role, 'user')
}
