/** The seeded demo accounts the home page's demo picker signs in as (2026-09-24, round 16, DECISIONS #90; the picker, round 20; four logins since
 * S1d, DECISIONS #137). All four are members of the FIRST demo company, created by scripts/seed_demo_fixtures.py from the same cast that
 * docs/DEMO-PEOPLE.md lists (scripts/verify_seed_fixtures.py checks these addresses against it).
 *
 * Choosing one is a login like any other: the picker submits the ordinary sign-in flow
 * (AuthContext.login -> POST /api/auth/dev-login) with that email filled in. It is not a
 * bypass and adds no route or credential of its own; if an account does not exist on a
 * backend the sign-in fails and the picker says so. */

import type { Role } from '../features/auth/authApi'

export const DEMO_OWNER_EMAIL = 'owner_priya@try-demo.test'

export interface DemoAccount {
  /** Key under `home.demo.accounts` in the locale files (name and description). */
  id: 'owner' | 'adminFinance' | 'adminOperations' | 'corpSec'
  email: string
  role: Role
}

/** In the order shown: most access first. The two admins share a role on purpose, so a visitor can see two admins work on the same
 * documents; the Corp Sec is view-only (role viewer). There is no `user` role in the demo. */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { id: 'owner', email: DEMO_OWNER_EMAIL, role: 'owner' },
  { id: 'adminFinance', email: 'admin_jonathan@try-demo.test', role: 'admin' },
  { id: 'adminOperations', email: 'admin_aisyah@try-demo.test', role: 'admin' },
  { id: 'corpSec', email: 'corpsec_rachel@try-demo.test', role: 'viewer' },
]
