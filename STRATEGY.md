# Show Me Your Agents — Team AdHoc (E270203Z), SME Category

Written for: the team. Working strategy doc, not a submission.

## 1. The clock (verified from iss.nus.edu.sg/show-me-your-agents)

| Date | What |
|---|---|
| Sat 5 Sep 2026 | Kickoff (done) |
| Mon 7 – **Fri 25 Sep 2026** | Build phase |
| **Mon 28 Sep 2026** | Final submission → top 5 per category chosen |
| Sat 10 Oct 2026 | Finale Demo Day |
| Mon 19 Oct 2026 | Showcase + prizes, NUS-ISS Annual Luncheon |

**Today is 16 Sep. Nine build days left. Twelve to submission.**
Scope for that, not for the idea we wish we had time for.

## 2. The rubric (verbatim from the site — this is what we optimise)

> Practical & relevant to SME needs · Feasible to deploy or pilot · Secure &
> responsible in design · Sound technical architecture · Effective use of
> agentic AI · Measurable business impact

Three special awards (sponsored by SBF):
- **SME Ready** — most deployment-ready in an SME context
- **Best Agents Use** — most innovative + effective use of agentic AI
- **Social Impact** — greatest community/societal benefit

Prizes per category: $3,000 / $2,000 / $1,000 USD in AWS credits.

## 3. SME Category rules that bind us

- Team must **represent an SME** (turnover ≤ S$100M); proof may be required
- 2–4 members ✅ (we are 2), ≥1 technical ✅
- SME teams build for **their own business challenge** — we are *not* assigned
  the curated problem statements (those are for the Public Category)
- Ideas generated are deemed public resources

**Implication:** the winning SME entry is the one where the judge believes
*this is genuinely your problem and you will still be running it in December.*

## 4. The judges

Qualifying: EY-Parthenon (strategy partner), OCBC (head of data science),
Visa (senior director), NTT Data (delivery lead), A*STAR (senior scientist).
Final: **SBF Chief Smart Technologies Officer**, **DBS head of AI & Data
Platforms**, **AWS Head of Modernization & AI Transformation**, NUS-ISS
director, **VersaFleet founder** (SG SME SaaS, logistics).

Not a research panel. Every one of them will ask: what does it save, who
operates it on Monday, where does the data live, and is this actually agentic
or a CRUD app with an LLM bolted on.

## 5. The challenge to "SME digital diary"

The capture insight is right. The value framing loses. Scored honestly:

| Criterion | Diary as pitched |
|---|---|
| Practical & relevant | Weak — nostalgia is not an SME job-to-be-done |
| Feasible to pilot | Fine |
| Secure & responsible | Neutral |
| Sound architecture | Fine |
| **Effective use of agentic AI** | **Weak — "file photo by date" is EXIF, not an agent** |
| **Measurable business impact** | **Near zero — no $ figure exists** |

Two of six, including the two that decide the money. A DBS/SBF judge cannot
write a business case for a scrapbook. And "Best Agents Use" is unwinnable
when the headline AI task is reading a timestamp.

**Superseded in part — see RECALL.md.** The critique above holds only against
*passive scrollback for sentiment*. Reframed as **long-horizon retrieval**
("the 2020 invoices", "the foundation photos for the interview"), the timeline
is a co-equal pillar sharing one engine with the obligation side, and it
carries its own dollars: disallowed GST claims, rejected grant claims, lost
warranty and insurance evidence.

Row 1 of the table above therefore applies to the diary framing, not to recall.

## 6. The reframe — keep the ritual, move the payoff

**Every Singapore SME has a shoebox.** A WhatsApp chat, a drawer, a Drive
folder called "misc". Receipts, delivery orders, quotes, licence letters, IRAS
notices, photos of the reno. Nothing is filed. Two things go wrong:

1. **Retrieval.** Audit, insurance claim, warranty dispute, grant claim,
   staff handover → someone loses a day digging, or the document is simply gone.
2. **Obligations buried inside the documents.** "Licence expires 31 Dec."
   "Payment terms 30 days." "Notice 2 months before renewal." "Warranty 12
   months." Invisible until they bite.

Same snap-a-photo ritual. Different promise:

> **Forward anything. Never lose a document, never miss a deadline, and get
> five years of your business back as a timeline.**

The scrollback is the **second pillar**, not a by-product — see RECALL.md.
One engine, two directions: forward to obligations, backward to recall.
Unifying line: *chat models have no past and no future; this one has both.*

## 7. Why this scores

| Criterion | This framing |
|---|---|
| Practical & relevant | Universal to every SME; zero behaviour change (forward a photo) |
| Feasible to pilot | Chat-native, no ERP integration required to start |
| Secure & responsible | Confidence thresholds, human-in-loop, citations, retention policy — designed in, demoed live |
| Sound architecture | AWS-native: S3 + Bedrock + index; clean agent boundaries |
| **Effective use of agentic AI** | Router → Extractor → **Obligation** → Verifier → Archivist → Recall, with visible traces |
| **Measurable business impact** | Penalties avoided, GST input tax preserved, hours saved, grant claims substantiated — all in SGD |

## 8. Agent architecture

1. **Intake/Router** — classify: receipt, invoice, govt notice, contract,
   licence, HR doc, work photo. Routes to the right extractor.
2. **Extractor** — Claude vision → structured fields (vendor, amount, GST,
   doc no., dates, counterparty). Emits per-field confidence.
3. **Obligation agent** ← *the differentiator*. Reads for **future
   commitments** and converts them to dated obligations with lead times.
   Cross-references the SG statutory calendar.
4. **Verifier/Guardian** — validates against rules (GST arithmetic, date
   sanity, duplicate detection). Below threshold → human review queue.
   **Nothing silently auto-files.** This is the "secure & responsible" score.
5. **Archivist** — files it, builds the timeline, links related docs into
   **threads** (aircon: quote → invoice → warranty → repair photo → claim).
6. **Recall** — natural-language Q&A over the vault, answers cite the source
   page. "What did we pay for the aircon last year?"

**Agent Trace panel in the UI** — every step, handoff, token count, cost, and
confidence, plus the moment a human was asked. The hackathon is literally
called *Show Me Your Agents*. Show them. This is the Best Agents Use play and
it is cheap to build. Put cost-per-document on screen.

## 9. SG statutory calendar (verify each before the pitch)

| Obligation | Deadline | Miss cost |
|---|---|---|
| AGM (private co.) | within 6 months of FYE | composition/prosecution |
| ACRA Annual Return | within 7 months of FYE | **$300** if ≤3 months late, **$600** if >3 months |
| GST F5 | within 1 month of period end | late penalties |
| IRAS record retention | **5 years** | claims disallowed on audit |
| ECI, CPF, licence & lease renewals | *to verify* | — |

Sources: ACRA/IRAS guidance summaries, Sep 2026. Verify every number against
the primary source before it goes on a slide — a wrong figure in front of SBF
and DBS is fatal.

## 10. Nine-day plan

| Day | Target |
|---|---|
| Wed 17 | Lock SME + scope. Ingest → S3 → extract → store working end-to-end on 1 doc type |
| Thu 18 | Router + Extractor across 4 doc types. Confidence scoring |
| Fri 19 | Obligation agent + statutory calendar. Verifier + review queue |
| Sat 20 | Timeline UI + threads. Chat intake (Telegram) live |
| Sun 21 | **Hard MVP freeze.** Recall/Q&A with citations |
| Mon 22 | Agent Trace panel. Backlog run on real docs → the headline number |
| Tue 23 | Security/responsibility pass. Demo script written |
| Wed 24 | Record demo video. Slides |
| Thu 25 | Buffer. Build phase ends |
| Fri 26–Sun 27 | Polish, rehearse |
| Mon 28 | **Submit** |

## 11. Open items

- [ ] **Which SME do we represent, and what is its actual shoebox?**
- [ ] Exact submission deliverables (video length? repo? slides? live demo?)
      — confirm from the proposal form. Teams lose on format, not substance.
- [ ] Product name — **Shoebox** (names the problem) / **Kiasu** (local, bold)
      / **Paper Trail** (safe)
- [ ] Proof of SME affiliation ready

## 12. Infra — confirmed working

Gateway is an **OpenAI-compatible** proxy over Bedrock (`ollama-proxy-bedrock`):

```
POST https://api.softwaresystems.app/v1/chat/completions
Authorization: Bearer $LLM_GATEWAY_API_KEY
model: global.anthropic.claude-sonnet-4-5-20250929-v1:0   (aliases: sonnet4.5, sonnet, haiku)
```

Smoke-tested 16 Sep: returns 200 with usage accounting. `/v1/messages`
(Anthropic-style) is **not** available — use the OpenAI schema.
Use `haiku` for routing/classification, `sonnet4.5` for extraction and
reasoning. Token usage is worth showing on screen.
