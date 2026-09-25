/** What the signed-in header shows to whom (2026-09-24, round 14, DECISIONS
 * #88; reshaped by DECISIONS #106) — pure role rules, kept out of the components
 * so they are testable and the header itself stays layout. The role checks mirror
 * the server's (app/auth.py); they decide what is OFFERED, not what is allowed. */

import { roleAtLeast, type Role } from '../features/auth/authApi'
import { SIGNED_IN_NAV_ROUTES, type RouteId } from '../router/routes'

/** Whether this role is offered the Only me space: user and above (round 19, DECISIONS #94: a viewer cannot upload, so a
 * private space has nothing for them). Shared by the header nav and the phone bottom bar. */
export function canUsePrivateSpace(role: Role | null): boolean {
  return role !== null && roleAtLeast(role, 'user')
}

/** The inline nav items for this role, in order: Calendar, Search and Company Files for everyone, then Only me for user and
 * above. A role of null (still loading) gets the common three. */
export function signedInNavRoutes(role: Role | null): readonly RouteId[] {
  return SIGNED_IN_NAV_ROUTES.filter((id) => id !== 'only-me' || canUsePrivateSpace(role))
}

/** The inline items that only fit from `lg` (1024px) up. Below it the header keeps its round 14 pair, Calendar and Company Files,
 * because four items plus the language select, the avatar and the Upload button overlap at 640 to 1023px (measured, DECISIONS
 * #106); these two are in the account menu there instead (`narrowWidthMenuRoutes`). */
export const LG_ONLY_NAV_ROUTES: readonly RouteId[] = ['search', 'only-me']

/** What the account menu lists ABOVE Company Settings between `sm` and `lg`: the inline items that do not fit the header at
 * that width. Empty for nothing hidden; hidden by CSS above `lg` (they are in the header) and below `sm` (the phone's bottom
 * bar has them). */
export function narrowWidthMenuRoutes(role: Role | null): readonly RouteId[] {
  return signedInNavRoutes(role).filter((id) => LG_ONLY_NAV_ROUTES.includes(id))
}

/** The pages the account menu links to, above Log Out: Company Settings for admin and owner and nothing for anyone else
 * (DECISIONS #106; it used to carry Tags, Search and Only me too). Admin sees the settings page read-only, so the entry is
 * theirs too (the same call DECISIONS #64 made; the fields stay owner-only editable, enforced in CompanySettingsPage and the
 * backend). */
export function accountMenuRoutes(role: Role | null): readonly RouteId[] {
  return role !== null && roleAtLeast(role, 'admin') ? ['company-settings'] : []
}

/** Whether the header offers the Upload button. A viewer is refused by the
 * server (POST /api/documents needs `user`), so the button should not exist
 * for them: with no Get Started when signed in, their header simply has no
 * button. */
export function canOfferUpload(role: Role | null): boolean {
  return role !== null && roleAtLeast(role, 'user')
}
