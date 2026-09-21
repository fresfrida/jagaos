# SG regulatory context — what's safe to auto-fetch, and what isn't

Written for: the team. Answers "add a SG context skill, auto-fetched
and auto-updated from a website." Grounded in three live checks just run
(16 Sep), not speculation — including one that failed, which turns out to be
the whole argument.

---

## 0. The three checks, and what they showed

1. **Fetched ACRA's late-filing penalties page.** Worked cleanly, no bot
   block, real figures came back: **$300** (≤3 months late), **$600**
   (>3 months late), annual return due **7 months** after FYE, **$10,000**
   max court fine, **$500** minimum composition sum, director disqualification
   after **3 offences in 5 years**. Government prose pages are, in fact,
   fetchable.

2. **Fetched a guessed IRAS URL for the GST filing deadline. It 404'd.**
   The page had moved or the guess was wrong. This is not a hypothetical
   risk — it happened in this session, seconds ago, on the first real
   attempt.

3. **Searched for ACRA's own open-data offering.** It exists —
   [ACRA's Open Data Initiative](https://www.acra.gov.sg/resources/open-data-initiative/)
   publishes **structured, versioned datasets** of every registered entity
   (UEN, entity type, registration date, status), updated monthly, via a
   real API with an API key, on
   [data.gov.sg](https://data.gov.sg/collections/2/view). But — per the
   search results — **it covers entity registry facts, not compliance
   deadlines or penalty rules.** Those live only in prose, on pages like the
   one in check 1.

Those three results, together, are the whole design.

## 1. Two different kinds of "SG context" — treat them oppositely

| | Registry facts | Regulatory rules |
|---|---|---|
| Example | UEN, entity type, incorporation date, status | "AR due 7 months after FYE," the $300/$600 penalty |
| Source | ACRA Open Data API — structured, versioned, built for this | prose on an informational page — built for humans |
| Changes | monthly, mechanically | rarely, and only by legislative/Budget change |
| Safe to auto-fetch and apply live? | **Yes** | **No** |

**Registry facts** are exactly what auto-fetch is for: an official, stable,
schema'd feed, designed to be consumed programmatically. Point our own
company-profile lookup at it directly.

**Regulatory rules** are prose with no schema and no contract. A page can be
restructured, a URL can move (check 2 just proved this), or a scraper can
misparse a paragraph and silently produce a legally wrong deadline. That
failure mode is worse than not having the feature at all, because a
compliance product that's confidently wrong is more dangerous than one that
says "verify with your corp sec."

## 2. Design: registry facts auto-fetch; rules are versioned and watched, never silently rewritten

### 2a. Company profile — real auto-fetch, safe to build

When Mei sets up her company in Settings, look her UEN up against the ACRA
Open Data API and auto-fill entity name, type, registration date, status —
instead of asking her to type it all in. Small, genuinely nice UX win, and
it's the "auto-fetched and kept current" capability actually being asked for,
applied to the data that supports it.

```
company.uen  ──►  ACRA Open Data API (data.gov.sg)  ──►  name, type,
                                                          incorporated_on,
                                                          status
```

Re-check monthly (matches the dataset's own update cadence); if a company's
`status` flips to struck-off or dissolved, that is itself worth surfacing —
possibly the single most important obligation cue an SME could get.

### 2b. Regulatory rules — a versioned skill folder, not a live scraper

```
skills/sg-context/
├── rules.yaml          the actual facts the obligation engine reads
├── sources.yaml         one entry per citation: url, last_verified_on,
│                        verified_by, content_hash
├── watcher.py           re-fetches each source, diffs against the stored
│                        hash, and on any change: FLAGS FOR REVIEW — never
│                        edits rules.yaml itself
└── CHANGELOG.md          every rule change, dated, with who approved it
```

`rules.yaml` entry, shape:

```yaml
- id: SG.ACRA.AR.7M
  label: "Annual Return"
  plain: "your yearly update to ACRA"
  due: "7 months after FYE"
  applies_even_if_dormant: true
  penalty:
    within_3_months: "S$300"
    after_3_months: "S$600"
  source_url: "https://www.acra.gov.sg/manage/companies/legal-requirements-common-offences/filing-annual-returns-companies/penalties-enforcement-late-annual-return-filing/"
  source_quote: "Up to three months after the deadline: $300 ... More than three months after the deadline: $600"
  last_verified_on: "2026-09-16"
  verified_by: "fetched live, 16 Sep 2026 — see check 1 above"
```

`watcher.py` runs on a schedule (weekly is plenty — these facts move at the
speed of legislation), refetches `source_url`, hashes the relevant text
block, and compares to `content_hash` in `sources.yaml`:

- **unchanged** → update `last_checked_on`, nothing else happens
- **changed, or URL moved/404'd** (exactly what happened in check 2) →
  write a `review_needed` flag with a diff, **the obligation engine keeps
  using the last human-verified value**, nothing changes live until someone
  confirms

This is the same shape as the document review queue (UI-SPEC.md §4) applied
one level up: **the machine proposes a rule change, a human confirms it.**
Consistent architecture, not a special case.

### Why this is a stronger demo than either extreme

Not this: hand-typed numbers with no freshness story, and a judge asks "how
do you know these are still current?"

Not this either: a live scraper that could silently get a legal deadline
wrong, which undermines the entire "secure & responsible" claim the rest of
the product is built on.

Instead: *"Every rule cites its source and the date we last verified it. A
watcher rechecks weekly and flags drift for review — it never edits a live
rule by itself."* Demoable in one screen, and it directly answers "why
should we trust this."

## 3. Where this fits, whichever harness we land on

Independent of the still-open LangGraph-vs-Hermes decision — this is a folder
of data plus one small script, not a framework-specific integration. If we
land on Hermes, this folder is a natural fit for its skill format (you
mentioned the folder-based structure already); if we build on LangGraph, it's
exactly the `rules/` directory ARCHITECTURE.md already sketched. Either way,
it's the same design.

## 4. Scope for the sprint

**Worth building now:** `rules.yaml` + `sources.yaml`, hand-verified today
(check 1's numbers are a real start), citations included. This alone
outscores having no citations at all.

**Worth building if time allows:** `watcher.py` as a single scheduled script
— cheap, and it's the feature that makes the freshness claim demonstrable
rather than asserted.

**Not this sprint:** any live scrape feeding directly into a computed
deadline. Given check 2, this is not a hypothetical caution.
