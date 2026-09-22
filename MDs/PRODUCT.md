# Product definition

Written for: the team. Restored from the original DESIGN.md, which is
now the agent-facing design system. Superseded sections are marked.

---

## 1. The headline scenario: corporate secretary handover

The founder's lived experience, not a hypothetical:

> "When I moved corporate secretary, they asked me to dig all these things,
> and it's just a nightmare."

Why it is the right hero:

- **A forcing event with a deadline** — not a vague wish to be organised
- **Universal** — every company changes corp sec eventually, and the SG market
  churns constantly on price
- **Acutely painful and time-boxed** — days of digging, all at once
- **It is retrieval under pressure from a multi-year archive**
- **It is the moment you discover you never had the document at all**

The new corp sec asks for roughly: constitution, incorporation documents,
ACRA BizFile profile, share certificates, register of members, register of
directors, RORC, past AGM minutes, past annual returns, board resolutions,
financial statements, tax filings, bank mandates.
*(Verify against a real engagement checklist before the pitch.)*

**Demo:** *"Generate handover pack."* Thirty seconds, one indexed zip.

## 2. The killer feature: gap analysis

Not *"here is what you have"* — that is a filing cabinet.

> **"You have 14 of the 19 documents your new corporate secretary will ask
> for. Missing: 2023 AGM minutes, RORC register, share certificate for a director."**

Structurally impossible for a chat model: it does not know your corpus, so it
cannot know the holes in it. Knowing what *should* exist and comparing against
what *does* is the whole product in one sentence.

## 3. The model: company life events

Each event implies a document bundle **and** a statutory clock.

| Event | Documents expected | Obligation triggered |
|---|---|---|
| Incorporation | Constitution, BizFile profile, share certs, registers | First FYE, first AR |
| Office move | Tenancy, utilities, insurance, licence updates | ACRA registered-address change *(verify: 14 days)* |
| Corp sec change | Handover pack (§1) | ACRA lodgement of change |
| Director change | Consent to act, resolution, updated register | ACRA lodgement |
| GST registration | Registration letter | Quarterly F5, 1 month after period end |
| First employee | Contract, CPF setup | Monthly CPF *(verify due date)* |
| FY end | Financial statements | AGM 6 mo, AR 7 mo, ECI, Form C-S |
| Dormancy | Dormancy resolution | AR still due; Form C-S unless waived |

The agent's real job: **event → expected set → compare to actual → surface the
gap and the date.** That is the agentic loop, and it is not prompt-shaped.

## 4. Hero screen — **superseded**

The original horizontal four-lane timeline was a desktop analyst console.
See **UI-SPEC.md v2** for the mobile-first replacement, and **INDEXING.md §10**
for why the per-item rendering does not survive 2,200 items a year.

What survives from the original thinking:
- time is the primary axis
- **gaps are drawn, not listed**
- past evidence and future obligations belong on one continuum

## 5. Positioning: Iron Mountain, then past it

A good entry analogy — every judge knows the name instantly.

> *"Think Iron Mountain, but digital and priced for an SME."*

Then immediately upgrade, because storage is a commodity framing and we do not
want to be a storage company:

> **Iron Mountain is a warehouse. This is a records officer.**
> It reads what it stores, knows what is missing, and watches the clock.

Custody vs. comprehension. Pull vs. push. That is the line.

## 6. Stack and build order

Moved to **ARCHITECTURE.md** §1 and §10, which are authoritative.
See also **ARCHITECTURE.md §12** for where an agent earns its place and where
ordinary software is the correct answer.
