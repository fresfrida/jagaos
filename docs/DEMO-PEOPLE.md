# Demo people (fictional)

Every person, company, vendor and document in the demo data is FICTIONAL, made by `scripts/generate_seed_files.py` and applied by `scripts/seed_demo_fixtures.py` (DECISIONS #133). Names were chosen to be plausible and are not real people. Emails end in `.test`. There are no NRIC numbers or other real personal data anywhere.

**Business titles are not app roles.** The app has four roles (`owner`, `admin`, `user`, `viewer`; `app/auth.py`), and the user ruled that role labels are names only: no title inside a display name, and nothing in the app reads a title to decide what a person may do. A person's business title lives in this file and, per company, in `membership.title` (S3, DECISIONS #136), which `scripts/seed_demo_fixtures.py` writes from the same data as this table. History shows it next to the name.

The group is **Tembusu Holdings**. The picker owner (`owner_priya@try-demo.test`, Priya Ramanathan) owns all three companies. **The login picker (`web/src/config/demo.ts`) has exactly FOUR logins, in this order: `owner_priya@try-demo.test` (owner), `admin_jonathan@try-demo.test` (admin), `admin_aisyah@try-demo.test` (admin) and `corpsec_rachel@try-demo.test` (viewer, view-only).** All four are members of the FIRST company. Everyone else has a non-picker email and belongs to one company.

**There is no `user` role in the demo (S1d, the user's ruling).** Every company has an Owner, two Admins and a Corp Sec who is a viewer. Nur Aisyah Rahman, Ravi Chandran and Daniel Chia were `user`s and are now admins with their titles unchanged. Kavitha Subramaniam and Alvin Sim Jun Hao are DROPPED: no person, no membership, no document or History row. The app still has the `user` role; the demo simply never uses it.

**The Corp Sec is STRICTLY VIEW-ONLY (S1c).** In every company the person titled Corp Sec holds app role `viewer`, and no document, edit, purge request or cancel in the seeded data is attributed to any viewer. Statutory documents are uploaded by an admin or the owner. The External Auditor (Marcus Lee Kok Wai) is a NON-PICKER viewer who performs no action. Nothing in `app/auth.py` changed: a viewer is already blocked from every write route.

## Tembusu Row Engineering Pte Ltd

Financial year end 31/12; incorporated 2016-03-14; GST-registered, quarters end Mar, Jun, Sep, Dec.

| Person | Login email | Company | App role | Business title | Login picker |
|---|---|---|---|---|---|
| Priya Ramanathan | `owner_priya@try-demo.test` | Tembusu Row Engineering Pte Ltd | owner | Managing Director | yes |
| Jonathan Ong | `admin_jonathan@try-demo.test` | Tembusu Row Engineering Pte Ltd | admin | HR & Finance Manager | yes |
| Nur Aisyah Rahman | `admin_aisyah@try-demo.test` | Tembusu Row Engineering Pte Ltd | admin | Operations Executive | yes |
| Rachel Tan Hui Min | `corpsec_rachel@try-demo.test` | Tembusu Row Engineering Pte Ltd | viewer | Corp Sec | yes |
| Marcus Lee Kok Wai | `marcus.lee@chenrahim.test` | Tembusu Row Engineering Pte Ltd | viewer | External Auditor | non-picker |

## Pasir Kelana Logistics Pte Ltd

Financial year end 30/6; incorporated 2018-08-20; GST-registered, quarters end Jan, Apr, Jul, Oct.

| Person | Login email | Company | App role | Business title | Login picker |
|---|---|---|---|---|---|
| Priya Ramanathan | `owner_priya@try-demo.test` | Pasir Kelana Logistics Pte Ltd | owner | Group Managing Director | yes (the same login as the first company) |
| Hafiz Ismail | `hafiz.ismail@pasirkelana.test` | Pasir Kelana Logistics Pte Ltd | admin | HR & Finance Manager | non-picker |
| Ravi Chandran | `ravi.chandran@pasirkelana.test` | Pasir Kelana Logistics Pte Ltd | admin | Dispatch Coordinator | non-picker |
| Grace Lim Siew Ling | `grace.lim@pasirkelana.test` | Pasir Kelana Logistics Pte Ltd | viewer | Corp Sec | non-picker |

## Cendana Wharf Trading Pte Ltd

Financial year end 31/3; incorporated 2020-01-06; not GST-registered.

| Person | Login email | Company | App role | Business title | Login picker |
|---|---|---|---|---|---|
| Priya Ramanathan | `owner_priya@try-demo.test` | Cendana Wharf Trading Pte Ltd | owner | Group Managing Director | yes (the same login as the first company) |
| Ng Bee Hong | `beehong.ng@cendanawharf.test` | Cendana Wharf Trading Pte Ltd | admin | Finance & HR Manager | non-picker |
| Daniel Chia | `daniel.chia@cendanawharf.test` | Cendana Wharf Trading Pte Ltd | admin | Purchasing Executive | non-picker |
| Farah Yusof | `farah.yusof@cendanawharf.test` | Cendana Wharf Trading Pte Ltd | viewer | Corp Sec | non-picker |
