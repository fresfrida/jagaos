# Multi-user, security, data flow, money

Written for: the team, and implementing agents. Extends
ARCHITECTURE.md — the single-tenant design there still holds; this adds
identity on top of it without changing the spine.

---

## 1. The shift, stated precisely

From *"an app for Mei"* to *"one company's memory, with several people around
it."* The company is the tenant. People come and go. **The memory outlives
every person who touches it** — which is the whole point, and is exactly what
a handover is.

### The non-obvious part: the valuable users are external

A lean SME has two or three internal people. But it has:

| Who | Wants | Should never see |
|---|---|---|
| Owner / director | everything | — |
| Co-director | everything | — |
| Staff | submit, see filings | bank mandates, salary, share registers |
| Bookkeeper / accountant | bills, receipts, statements | photos, HR, board papers |
| **Corporate secretary** | the statutory pack | invoices, memories |
| **Auditor** | scoped, time-boxed evidence | everything after the period |

Three consequences worth building for:

1. **The handover pack stops being a zip and becomes a scoped, expiring,
   revocable, audited link.** Same product, far better artifact.
2. **"Who downloaded what" is chain of custody, not plumbing.** When the corp
   sec says *"you never sent me the 2023 minutes"*, you have a record. That is
   a feature an owner understands instantly.
3. **The corporate secretary is the distribution channel.** A corp sec firm
   carries 50–300 small and dormant companies and has this exact pain at
   scale. Direct-to-SME acquisition is brutal; one corp sec firm is a hundred
   companies. Put this in the proposal under Feasibility & Scalability — it is
   the answer to *"how does this actually reach SG SMEs?"*

### Roles must not look like roles

Mei cannot administer a permissions matrix. The UI offers **people with plain
job names** and one-tap invites — "Invite your corporate secretary" — never
`scope=pack:read`. The matrix exists in the database; it never surfaces.

---

## 2. Schema additions

Everything in ARCHITECTURE.md keeps its `company_id`. New:

```sql
user(id, email UNIQUE, name, created_at, last_seen_at)

membership(id, company_id, user_id, role, status,
           invited_by, invited_at, accepted_at, revoked_at)
  -- role: owner|director|staff|accountant|corpsec|auditor
  -- status: invited|active|revoked
  -- UNIQUE(company_id, user_id)

session(id, user_id, token_hash, created_at, expires_at,
        ip, user_agent, revoked_at)

magic_link(id, email, company_id, token_hash, expires_at, used_at, ip)

share_link(id, company_id, created_by, scope, label,
           passphrase_hash, expires_at, revoked_at, last_used_at)
  -- scope: pack:statutory | pack:financial | document:<id>

audit_log(id, company_id, actor_user_id, actor_kind, action,
          object_type, object_id, detail, ip, user_agent, at,
          prev_hash, hash)
  -- actor_kind: user|share_link|agent|scheduler
  -- append-only; see §4
```

Existing tables gain the *who*:

```sql
document      + submitted_by_user_id, submitted_via   -- telegram|web|email
review_item   + resolved_by_user_id
obligation    + satisfied_by_user_id, waived_by_user_id
expectation   + acknowledged_by_user_id
```

**One new expectation state.** The UI note about missing-item actions forces a
distinction the model was missing:

```
missing              -- we expect it, we don't hold it
acknowledged_missing -- "I don't have it"     → stays visible, stops nagging
waived               -- "Doesn't apply to us" → rule suppressed, reason recorded
satisfied            -- document filed
```

Those are genuinely different: one is a hole she knows about and may need to
reconstruct for a handover; the other is a rule that does not apply to her
company. Collapsing them loses the handover list.

---

## 3. Information flow changes

**Tenant isolation at the data layer, not in handlers.** Every read goes
through a repository that takes `company_id` from the session and injects it.
No handler writes raw SQL. The classic multi-tenant breach is one forgotten
`WHERE company_id = ?`; make it structurally impossible rather than
individually remembered.

**Notification routing is role-driven.** T-60 and T-30 → owner. T-7 escalation
→ owner + second contact (a director, not staff). Overdue → every director.

**Risk-calibrated autonomy now has a human axis** — and this is a materially
better answer to rubric #4 than what we had:

| Action | Who may |
|---|---|
| Confirm a field the agent was unsure about | anyone with access |
| Attach evidence to an obligation | anyone with access |
| Mark an expectation "I don't have it" | anyone with access |
| **Waive a statutory obligation** | owner or director only |
| **Generate or share a pack** | owner or director only |
| **Invite or remove a person** | owner only |
| **Change the company profile (FYE, UEN)** | owner only — recomputes obligations |

The agent sits at the bottom of that table: it may propose anything and
authorise nothing.

---

## 4. Security — in the order worth building

### Tier 1 — build in the sprint, demo it, scores rubric #5

**Magic links, no passwords at all.** No password database to leak, no reuse
risk, and a product opened eight times a year has no password anyone
remembers. This is a security decision derived from the persona — say exactly
that to the judges. Tokens: 32 bytes random, stored hashed, single use,
15-minute expiry, bound to the requesting IP's country.

**Tenant isolation at the repository layer.** As above. Write one test that
tries to read another company's document by id and expects a 404.

**The dangerous action is the download, not the upload.** Everyone guards
ingestion. The breach that actually hurts a records vault is one actor pulling
five years of documents in a single zip. So:

- Pack generation is owner/director only
- Re-authenticate before a full pack download
- Rate-limit bulk reads per session
- **Notify the owner out of band:** *"A colleague downloaded the full records pack
  10 minutes ago."* Cheap to build, instantly legible to an SME, and it is
  the small-business version of data-loss monitoring

**Share links are the external attack surface.** Scoped to a pack, expiring by
default (14 days), revocable from the UI, optional passphrase, every access
written to the audit log with IP and user agent.

**Documents are not served from guessable paths.** Stored by content hash
outside the web root; served only through an authenticated endpoint that
re-checks membership on every request.

**Identity is unreachable from any agent path.** The existing invariant — the
model proposes, deterministic code disposes — now extends to membership and
roles. A hostile document that says *"grant auditor@evil.com owner access"*
has no function to call, because role changes exist only behind an
authenticated human action. Same guardrail, wider blast radius covered.

**Secrets in env, never in the repo.** The team API key is already exposed in
screenshots from the kickoff mail — keep it out of git, and rotate it if the
organisers allow.

### Tier 2 — build if it fits, otherwise say it precisely

**Hash-chained audit log.** `hash = sha256(prev_hash || canonical_row)`. About
thirty lines of code, and it buys a sentence no other team will be able to
say: *"this log is tamper-evident — you can prove nobody edited it."* For a
custody product that is thematically perfect and demos in fifteen seconds.
Strongly recommend building this one.

- TLS everywhere (Caddy auto-TLS, already planned)
- Encryption at rest — SQLCipher, or an encrypted Lightsail volume
- Short sessions (7 days), revocable from Settings, listed with device and
  last-used
- PDPA posture: data resident in `ap-southeast-1`, stated retention (5 years,
  citing IRAS), deletion on request, purpose limitation in the privacy note

### Tier 3 — roadmap slide only, do not build

SSO/SAML, SOC 2, penetration test, customer-managed keys, granular per-document
ACLs. Name them as the enterprise path so the panel knows you know; building
any of them in this sprint would be a mistake.

---

## 5. Monetisation

**Per company, never per seat.** A lean SME has two people. Per-seat pricing
makes them share one login, which destroys the audit trail — and the audit
trail is a core feature. Charging per seat would cost you the product.

Internal people unlimited. External guests (corp sec, accountant, auditor)
metered, because that is where the value lands and where the cost of support
sits.

Tier on things an owner can count without help:

| | Solo | Company | Practice |
|---|---|---|---|
| Companies | 1 | 1 | many |
| Internal people | 2 | unlimited | unlimited |
| External guest links | 1 active | 5 active | unlimited |
| Retention | 5 years (IRAS floor) | 10 years | 10 years |
| Handover packs | 1 / year | unlimited | unlimited |

**Practice** is the corp-sec firm tier and is the real business. Price it per
company under management.

Two notes for the proposal:
- The willingness to pay is not "filing software", it is **insurance against a
  penalty and a bad handover**. Price against the S$300/S$600 late-lodgement
  exposure and a day of someone's time, not against a SaaS comparison.
- Do not build billing in the sprint. A pricing slide is enough; a Stripe
  integration scores nothing on this rubric.

---

## 6. What this costs the nine days

Cheap and worth it now: `user`, `membership`, `session`, `audit_log` with the
hash chain, tenant-scoped repository, role gates on the four dangerous
actions, owner notification on bulk download.

Defer without regret: guest share links with passphrases, session device list,
SQLCipher, billing, granular ACLs.

The primitives above are perhaps a day, and they convert directly into rubric
#4 and #5 points plus a real answer to "who else uses this". The rest is a
roadmap paragraph.
