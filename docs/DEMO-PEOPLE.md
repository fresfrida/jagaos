# Demo people (fictional)

Every person, company, vendor and document in the demo data is FICTIONAL, made by `scripts/generate_seed_files.py` and applied by `scripts/seed_demo_fixtures.py` (DECISIONS #133). Names were chosen to be plausible and are not real people. Emails end in `.test`. There are no NRIC numbers or other real personal data anywhere.

**Business titles are not app roles.** The app has four roles (`owner`, `admin`, `user`, `viewer`; `app/auth.py`), and the user ruled that role labels are names only: no title inside a display name, and nothing in the app reads a title to decide what a person may do. A person's business title lives in this file and, per company, in `membership.title` (S3, DECISIONS #136), which `scripts/seed_demo_fixtures.py` writes from the same data as this table. History shows it next to the name.

The group is **Tembusu Holdings**. The picker owner (`owner@try-demo.test`, Priya Ramanathan) owns all three companies; the six emails in the demo login picker (`web/src/config/demo.ts`) are all members of the FIRST company. People with other emails are members of one company each and are not in the picker.

**Why the Company Secretary is app role `user`, not `admin`:** the Corp Sec uploads and corrects her own statutory filings, which is what a `user` may do (edit only what you uploaded). Resolving reviews, adding members and seeing which checklist items are missing are admin and owner work, and those belong to the HR and Finance Manager and the Managing Director here.

## Tembusu Row Engineering Pte Ltd

Financial year end 31/12; incorporated 2016-03-14; GST-registered, quarters end Mar, Jun, Sep, Dec.

| Person | Email | Company | App role | Business title | In the login picker |
|---|---|---|---|---|---|
| Priya Ramanathan | `owner@try-demo.test` | Tembusu Row Engineering Pte Ltd | owner | Managing Director | yes |
| Jonathan Ong | `admin@try-demo.test` | Tembusu Row Engineering Pte Ltd | admin | HR & Finance Manager | yes |
| Rachel Tan Hui Min | `user@try-demo.test` | Tembusu Row Engineering Pte Ltd | user | Corp Sec | yes |
| Nur Aisyah Rahman | `user1@try-demo.test` | Tembusu Row Engineering Pte Ltd | user | Operations Executive | yes |
| Kavitha Subramaniam | `user2@try-demo.test` | Tembusu Row Engineering Pte Ltd | user | Sales & Admin Coordinator | yes |
| Marcus Lee Kok Wai | `viewer@try-demo.test` | Tembusu Row Engineering Pte Ltd | viewer | External Auditor | yes |

## Pasir Kelana Logistics Pte Ltd

Financial year end 30/6; incorporated 2018-08-20; GST-registered, quarters end Jan, Apr, Jul, Oct.

| Person | Email | Company | App role | Business title | In the login picker |
|---|---|---|---|---|---|
| Priya Ramanathan | `owner@try-demo.test` | Pasir Kelana Logistics Pte Ltd | owner | Group Managing Director | yes (owner) |
| Hafiz Ismail | `hafiz.ismail@pasirkelana.test` | Pasir Kelana Logistics Pte Ltd | admin | HR & Finance Manager | no |
| Grace Lim Siew Ling | `grace.lim@pasirkelana.test` | Pasir Kelana Logistics Pte Ltd | user | Corp Sec | no |
| Ravi Chandran | `ravi.chandran@pasirkelana.test` | Pasir Kelana Logistics Pte Ltd | user | Dispatch Coordinator | no |

## Cendana Wharf Trading Pte Ltd

Financial year end 31/3; incorporated 2020-01-06; not GST-registered.

| Person | Email | Company | App role | Business title | In the login picker |
|---|---|---|---|---|---|
| Priya Ramanathan | `owner@try-demo.test` | Cendana Wharf Trading Pte Ltd | owner | Group Managing Director | yes (owner) |
| Ng Bee Hong | `beehong.ng@cendanawharf.test` | Cendana Wharf Trading Pte Ltd | admin | Finance & HR Manager | no |
| Farah Yusof | `farah.yusof@cendanawharf.test` | Cendana Wharf Trading Pte Ltd | user | Corp Sec | no |
| Daniel Chia | `daniel.chia@cendanawharf.test` | Cendana Wharf Trading Pte Ltd | user | Purchasing Executive | no |
