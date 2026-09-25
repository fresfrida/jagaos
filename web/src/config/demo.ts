/** The seeded demo accounts the home page's demo picker signs in as (2026-09-24,
 * round 16, DECISIONS #90; the picker, round 20). All six belong to "Try Demo Pte Ltd",
 * created by scripts/seed_dev_db.py (its OWNER_EMAIL and account list are these addresses).
 *
 * Choosing one is a login like any other: the picker submits the ordinary sign-in flow
 * (AuthContext.login -> POST /api/auth/dev-login) with that email filled in. It is not a
 * bypass and adds no route or credential of its own; if an account does not exist on a
 * backend the sign-in fails and the picker says so. */

import type { Role } from '../features/auth/authApi'

export const DEMO_OWNER_EMAIL = 'owner@try-demo.test'

export interface DemoAccount {
  /** Key under `home.demo.accounts` in the locale files (name and description). */
  id: 'owner' | 'admin' | 'user' | 'user1' | 'user2' | 'viewer'
  email: string
  role: Role
}

/** In the order shown: most access first. user1 and user2 share a role on purpose, so a
 * visitor can check that one user's files and private files stay hidden from the other. */
export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { id: 'owner', email: DEMO_OWNER_EMAIL, role: 'owner' },
  { id: 'admin', email: 'admin@try-demo.test', role: 'admin' },
  { id: 'user', email: 'user@try-demo.test', role: 'user' },
  { id: 'user1', email: 'user1@try-demo.test', role: 'user' },
  { id: 'user2', email: 'user2@try-demo.test', role: 'user' },
  { id: 'viewer', email: 'viewer@try-demo.test', role: 'viewer' },
]
