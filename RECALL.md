# Second pillar: recall across years

Written for: the team.

## Correction to earlier framing

I filed "scroll back through the years" under nostalgia and called it
dilution. That was wrong, and the distinction matters:

- **Passive scrollback for sentiment** — weak, no buyer
- **Retrieval under time pressure, years later** — strong, and the same
  underlying capability

The founder's cases are the second kind:

> "I want the invoices from 2020."
> "Where are the digging-foundation pictures for that interview?"
> "It's buried and lost, and when we need it most we can't find it."

Nobody is being sentimental there. Someone has a deadline and the artifact is
gone.

## Why this is genuinely hard (and why it is not a feature of chat)

**1. The thing you need in 2031 had to be captured in 2026.**
Retrieval value arrives years after capture cost is paid. That gap is exactly
why nobody builds for it and why every SME has the problem. No future model
retrieves what was never captured — this is the one failure that better AI
cannot fix retroactively.

**2. People search by fuzzy human memory, not keywords.**
*"The aircon guy, maybe 2022, the one before we moved shops."* No folder tree
survives that. Resolving it is multi-hop: relative reference → business event
("moved shops") → date bound → search within window. That is agentic
retrieval, not search.

**3. Photos carry no text.**
An invoice has words to index. A photo of a foundation being dug has nothing.
It must be described and linked to what the business was doing that month —
**at ingest**. Capture-time enrichment is the moat, and it only pays off in
year five.

## The unifying story

Two pillars, one engine, one sentence:

> **Chat models have no past and no future. This one has both.**

| Direction | Job | Payoff |
|---|---|---|
| Forward | Obligations — act on the right day | Don't miss the deadline |
| Backward | Recall — find it years later | Don't lose the evidence |

Same ingest, same enrichment, same provenance, same store. The product is
about **time**, which is precisely the axis a chat session does not have.
This makes the pitch simpler, not broader.

## Why not Google Photos / Apple Photos

They do semantic photo search now. Be honest about it, then draw the line:

- They search **one person's camera roll**, not the business's shared corpus
  across owner, site supervisor and corporate secretary
- They hold no invoices, contracts or government letters beside the photos
- They cannot resolve *"before we changed the signage"* — no business events
- No provenance chain an auditor would accept
- **When the employee leaves, the company's history leaves with them** — it
  was in their personal account the whole time

That last one is a business-continuity argument, not a features argument.

## Where the dollars are

Retrieval failure is expensive in specific, nameable ways:

- **GST input tax disallowed** on audit because the tax invoice can't be produced
- **Grant claims rejected** (PSG/EDG) for missing supporting documents
- **Warranty / defects liability** — can't prove install date or condition
- **Insurance claims** — no before/after evidence
- **Tenders and prequalification** — track record evidence, past project photos
- **Landlord and supplier disputes** — the message and the photo
- **Succession / handover** — the one person who knew everything leaves
- **Due diligence** when the business is sold

The "interview" case generalises: PR, tenders, grants, anniversaries — all
need proof of history on short notice.

## The demo problem (real constraint)

A dormant SME has no five-year archive. We cannot fake depth we don't have.

Plan:
1. **Real where we have it.** The founder's own 2020–2026 photos and the company's
   incorporation-era documents. One genuine retrieval — *"find the photo from
   our incorporation day"* — beats any amount of synthetic data.
2. **Clearly-labelled demo corpus** for depth: a five-year document set for a
   fictional renovation contractor or F&B outlet. State on the slide that it
   is synthetic. Being upfront reads as credibility, not weakness.

Never blend the two silently.

## Demo beat 3 — the impossible question

Ask something you would genuinely struggle with:

> *"Find the photo of the foundation being dug — I think it was before we
> changed the signage."*

It resolves the relative reference through a business event, returns the
photo, its date, and what else happened that week. Then: *"try that on your
camera roll."*

Every person in that room has this problem personally. Universal recognition
is worth more than a clever architecture slide.

## Cost to the 9-day build

Shares ~90% of the infrastructure with the obligation engine. Additional:

- Vision captioning at ingest — one extra call, trivial
- Timeline view — moderate
- Semantic search — corpus is small, brute-force over metadata is fine; no
  vector DB needed for the demo
- Business-event anchoring ("moved shops", "changed signage") — small, and it
  is what makes beat 3 work

Roughly +1.5 days. Pay for it by keeping invoice handling narrow.
