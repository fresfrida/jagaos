/** The seeded demo account the home page's "Take a look around" button signs in
 * as (2026-09-24, round 16, DECISIONS #90). It is the owner of "Try Demo Pte Ltd",
 * created by scripts/seed_dev_db.py (`OWNER_EMAIL` there is the same address).
 *
 * This is a login like any other: the button submits the ordinary sign-in flow
 * (AuthContext.login -> POST /api/auth/dev-login) with this email pre-filled. It
 * is not a bypass and adds no route or credential of its own; if the account does
 * not exist on a backend the sign-in fails and the button says so. */
export const DEMO_OWNER_EMAIL = 'owner@try-demo.test'
