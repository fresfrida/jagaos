# Write-up document (draft)

Started 2026-09-21. This is the living draft of the required **write-up
document (PDF)** — one of the six submission fields in `SUBMISSION.md` §1,
due **28 Sep 2026, 09:00**. Structure and judging criteria are fixed by
`admin/SMYA - business proposal guidelines.pdf` (mirrored in `SUBMISSION.md`
§2): five sections, in this order, no invented structure. This doc is not
the PDF itself — export/format later. Fill in `TODO` items as real work
lands; do not invent numbers.

Every claim here must have a row in the claim ↔ evidence table (§6) with a
video timestamp, per `SUBMISSION.md` §3.

---

## 1. Problem & Opportunity

**Who & what.** Singapore SME directors and the person who acts as company
secretary for them (often the director, sometimes an outsourced corp sec
firm). The task: keep every statutory document, deadline and decision
retrievable, across a corp sec handover, an IRAS audit, a grant claim, or due
diligence at sale.

**The true story (lead with this, not the category):**

> When we changed corporate secretary, they sent us a list of nineteen
> documents. We had fourteen. We didn't know which five were missing until
> we spent a weekend finding out.

**Why it matters.** This is not hypothetical — it happened to the team
(`WINNING.md` Part 5). Every SG SME director has felt some version of it.
Avoid "we want to build an AI chatbot" framing (guidelines explicitly warn
against this); describe the process and the weekend of digging instead.

**Current situation.** No system watches statutory deadlines or the
completeness of the document set. Records live scattered across email,
WhatsApp, paper, and whatever the outgoing corp sec hands over. Nothing
flags a gap until someone asks for a document that turns out not to exist.

TODO: one paragraph on the current manual workflow/journey (how a director
actually tracks this today), for the "Current Situation" sub-bullet the
guidelines ask for.

---

## 2. Business Value

Map to the six value types from the guidelines (Productivity, Cost, Revenue,
Service, Risk, Scale). Ours, per `SUBMISSION.md` §2:

- **Risk** — missed statutory deadlines; s155 disqualification exposure;
  IRAS input-tax disallowance when a tax invoice can't be produced; PSG/EDG
  grant claims rejected for missing support; due-diligence price chips.
- **Productivity** — the handover weekend, eliminated.
- **Cost** — penalties avoided, GST input tax preserved, grant claims
  substantiated.

State the two-halves argument explicitly (`INDEXING.md` §0): **the
obligation engine is the recurring value; the archive is the
catastrophic-avoidance value.** For a dormant company the obligation engine
alone is thin — the archive is what makes it worth paying for, and it
compounds (near-worthless year one, irreplaceable year five). Say the
compounding out loud; it is also the answer to "why hasn't this been solved."

**The moat, one sentence** (`MOAT.md`): a chat model can read any document
you show it — it can't tell you which document you're *missing*, because it
doesn't know what you have.

**Competitive note — Apple Siri AI** (`MOAT.md` §"Isn't this just Siri
now?", added 2026-09-21): Siri AI launched fall 2026 with on-device agent
capability, and is the most credible near-term counter a judge may raise.
Verified via web search: it runs on iPhone/iPad/**Mac (M1+)**/Vision
Pro/Watch — not phone-only, so don't claim a device restriction on stage.
The real differentiation is structural, not platform-availability: Siri is a
single-user assistant tied to one Apple ID with no company-shaped shared
record, no 5-year compliance provenance, no statutory obligation model, and
requires org-wide recent Apple hardware (a real lock-in problem for a mixed
Windows/Android SME) — while JagaOS runs as a web app + Telegram bot on any
device, on the company's own AWS. Gap analysis (the moat sentence above)
still stands untouched by this launch.

---

## 3. Impact & Outcomes

Judges want KPIs with numbers, measured, not projected (`SUBMISSION.md` §2).

| Metric | Value | Status |
|---|---|---|
| Documents indexed | **8** (synthetic demo corpus) | measured, `evals/demo_corpus/RESULTS.md` |
| Gaps found vs. expected document set | **2 of 6** (demo corpus) / **14 of 19** (the team's real, personal story) | both real — different corpora, see note below |
| Obligations derived, with citation | **2** (Annual Return, Form C-S/C) | measured |
| Documents correctly routed to human review (not silently accepted) | **1 of 8** (GST arithmetic mismatch) | measured |
| Injection attempts caught and quarantined, obligation untouched | **1 of 1** | measured, inside the real product flow, not an isolated eval case |
| Cost per document | **≈1.6¢ USD** (8 docs, $0.125 total) | measured, placeholder Anthropic list pricing — not yet the gateway's confirmed billed rate |
| Hours a gap analysis would take by hand | TODO | not measured — needs a human timing comparison |
| Retrieval time, minutes → seconds | TODO | recall graph not built yet |

**Important distinction for this section:** the "14 of 19" figure is the
team's own real, personal story (the corp sec handover that motivated this
project — `GAPS.md`'s opening line) and belongs in Problem & Opportunity
(§1 above) as lived experience, not as a system-measured result. The "2 of
6" figure **is** a system-measured result, but against a synthetic,
clearly-labelled demo corpus ("Bright Harbour Pte Ltd") built to protect
the team's actual document privacy — see `evals/demo_corpus/generate.py`.
Do not conflate the two in the write-up: one is a true anecdote, the other
is a system-verification run. Both are honest; neither should borrow the
other's authority.

---

## 4. Feasibility & Scalability

**Feasibility.**
- Data/knowledge to maintain it: the SME's own documents; no external data
  dependency.
- Systems: one AWS Lightsail box, JSON calls to Bedrock Claude Sonnet 4.5
  only (`GAPS.md` §5) — no S3/DynamoDB/Textract. SQLite + local disk.
- Human-in-the-loop: uncertain extractions and high-risk changes escalate to
  a person rather than guessing (e.g. the $327 vs $32.70 case,
  `SUBMISSION.md` claim table).
- Deployment: Lightsail, Caddy reverse proxy, systemd. Not live yet — see
  `docs/KANBAN.md` Blocked.
- Risk/exposure: prompt injection from third-party documents is a live,
  demoable threat (`GAPS.md` §3) — not hand-waved, treated as a headline
  guardrail feature.

**Scalability — the corp sec channel** (`SUBMISSION.md` §2, this is the
answer to "how does this reach SG SMEs"): one corp secretary firm carries
50–300 small companies with this exact pain. Distribution through firms, not
one SME at a time. Runs on the customer's own AWS; data is exportable; no
lock-in if the team disappears (`SUBMISSION.md` §7).

TODO: cross-functional workflow support, monitoring/governance, and the
prototype → pilot → production path — one paragraph each once the backend
skeleton exists.

---

## 5. Proposal Quality

Self-check against the guidelines' five adjectives before submitting:
**clear** (a business stakeholder, not just a developer, can follow it),
**concise**, **evidence-based** (every claim shown in the video), **consistent**
(problem → solution → value → KPIs connect), **stakeholder-aware** (reflects
the SME, its director, and its operating context, not a generic enterprise
buyer).

---

## 6. Claim ↔ evidence table

Copied from `SUBMISSION.md` §3 — keep both files in sync. Fill in real
timestamps once the video is cut.

| Proposal claim | Video timestamp | What is shown |
|---|---|---|
| Sorts and files without being asked | TODO | Telegram photo → filed |
| Asks when unsure rather than guessing | TODO | the $327 / $32.70 question |
| High-risk changes need a human | TODO | waiver blocked for non-directors |
| Resists hostile documents | TODO | injection quarantined, obligation untouched |
| Knows what you are missing | TODO | 14 of 19, with the rule for each |
| Acts when nobody is present | TODO | four months pass, message arrives |
| Learns your vocabulary | TODO | "to pay 2021" resolves |
| Costs cents per document | TODO | trace footer |

---

## 7. Separately: the proposal form

`SUBMISSION.md` §1 lists a **Proposal form** (QR code in the briefing deck)
as a separate checklist item from this write-up PDF, same deadline. TODO:
confirm on Slack whether it's a short-form duplicate of this document or
asks something distinct, and complete it separately — don't assume this
draft covers it.

---

## Status note (update every session)

**2026-09-21 (morning):** Draft scaffold created. Backend did not exist —
this was the single largest gap.

**2026-09-21 (later same day):** Backend skeleton built (`app/`,
`ARCHITECTURE.md` §9): the full loop (ingest → classify → extract → verify
→ human_review → derive_events → derive_expectations → derive_obligations
→ archive) is wired as a LangGraph `StateGraph` behind FastAPI. Verified
**without** the gateway key: DB schema, statutory date math, the injection
guardrail (10/10 adversarial cases, `evals/report.md`), GST arithmetic
checks, and authority-separated status transitions all pass real tests.

**2026-09-21 (same day, later still):** Ran classify → extract → verify
**live against the real gateway** on a synthetic invoice — correct lane,
all 7 fields extracted with citations and confidence, GST arithmetic
verified, no false review flag (`tests/test_gateway_live.py`). Found and
fixed two real bugs: only `sonnet4.5` is an approved model for this key (no
cheap-routing cost saving to claim in §3 below — say so plainly rather than
dropping it quietly); and tool calls need an explicit `max_tokens` or the
gateway silently truncates multi-field extractions (`GAPS.md` §11). One
extract call: 1508 input / 539 output tokens, ≈1.26¢ at Anthropic list
pricing (not yet the gateway's confirmed billed rate).

**2026-09-21 (evening):** Team decided against feeding real documents
through the pipeline (privacy — invoices/tax letters carry PII). Built
`evals/demo_corpus/` instead: 8 synthetic documents for a fictional SME,
run through the real FastAPI app end to end. Found and fixed three more
real bugs along the way (human-review pause detection, gap-analysis
doc_type matching, stale gap reconciliation — all in `docs/KANBAN.md`
Done and `docs/HANDOFF.md`). §3 above now has real measured numbers from
this run. Full report: `evals/demo_corpus/RESULTS.md`.

Still TODO: the recall graph (retrieval time metric), an hours-by-hand
comparison, and a decision on whether to load the real 19-item *checklist*
(not the real documents) into `app/rules/expectations.py`. Build phase
ends **25 Sep 2026** per `SUBMISSION.md` §6. Also still missing: the
scheduler/Telegram escalation ladder ("the clock" — the actual agent, per
`MOAT.md`) and the multi-user layer (`PLATFORM.md`). Full list:
`docs/KANBAN.md` Backlog.
