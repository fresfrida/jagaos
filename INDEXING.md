# Indexing, vocabulary drift, and the information workflow

Written for: the team, and implementing agents.
Extends ARCHITECTURE.md and PLATFORM.md. **This is the last design document
before code** — see §8 for what is v1 and what is a slide.

---

## 0. Correction: I was measuring the wrong thing

I said a dormant company has four obligations a year, so the ROI is thin.
That measured **how often the agent acts**. The right measure is **what the
failure costs when it happens**.

Obligations are a *flow*: four a year, small and regular.
The archive is a *stock*: it compounds, it never expires, and its failures are
**rare and expensive** rather than frequent and cheap.

| Retrieval failure | What it costs |
|---|---|
| Corp sec handover with no records | 1–2 days of a director's time, every switch — and SG corp secs churn on price |
| IRAS audit, tax invoice not producible | input tax disallowed — a direct cash loss |
| PSG/EDG claim missing supporting documents | the grant value, rejected |
| Insurance or warranty claim with no evidence | the claim value |
| Due diligence at sale | price chip, or deal friction |

So the business case has two halves that need each other:

> **The obligation engine is the recurring value. The archive is the
> catastrophic-avoidance value.** For a dormant company the first alone is
> thin — the second is what makes it worth paying for.

**And the compounding is the "why hasn't this been solved" answer**, which
judges always ask: the archive is nearly worthless in year one and
irreplaceable in year five. The payoff is deferred, which is exactly why
nobody builds it and exactly why every SME has the problem.

You cannot show five years of value in a thirty-minute video. So show the
**mechanism that makes year five work** — the indexing below — and state the
compounding out loud.

---

## 1. The real problem: her words change

> *"My naming for this 5 years ago and now may be different. Maybe I said
> 'to pay' 5 years ago. This year I say 'invoice'."*

This is the crux, and it kills naive search. Four distinct drifts:

1. **Vocabulary drift over time.** "to pay" → "invoice" → "bill". Searching
   with today's word misses everything filed under yesterday's.
2. **Personal vs canonical.** She says *"the aircon guy"*; the document says
   *ACME AIRCON SERVICES PTE LTD*. She says *"the Jurong place"*; the lease
   says *Blk 22 Jurong East St 21 #03-14*.
3. **Local vernacular.** "the reno", "CNY deco", "the kopitiam one".
4. **Relative time.** "before we moved shops", "the first year", "around when
   a co-director joined" — landmarks, not dates.

**And now it is a multi-user problem too.** One person's words are not another's. A
company-level vocabulary means one person can find what another filed, using their own
words. That is a real argument for company memory over personal memory — use
it in the pitch.

So the indexing job is not "extract fields and full-text search". It is:

> Build a **canonical index that never changes**, plus a **vernacular layer
> that records how these particular people talk**, and resolve every query
> through both — learning on each pass.

---

## 2. Five layers

**Layer 1 — Canonical.** What the document objectively is. `doc_type`,
amounts, dates, document numbers. Stable forever, never renamed.

**Layer 2 — Entities, resolved.** "ACME AIRCON", "Acme Aircon Services",
"acme a/c" collapse to one `party`. Same for places, people, assets and
projects. Every spelling ever seen is kept, because a future document may use
the old one.

**Layer 3 — The vernacular layer.** Her words, mapped to Layer 2, **with
dates attached**. "to pay" used 2019–2021; "invoice" from 2022. A query in
either word reaches both eras. *This is the differentiator.*

**Layer 4 — Temporal anchors.** Her landmarks resolved to date ranges.
"before we moved shops" → the `office_move` event → a window.

**Layer 5 — Resolution + learning.** At query time, resolve through 3 and 4,
**show the resolution**, let her correct it, and write the correction back
into Layer 3. Every search makes the next one better.

---

## 3. Schema

```sql
party(id, company_id, kind, canonical_name, uen,
      first_seen_on, last_seen_on, doc_count)
  -- kind: vendor|customer|authority|landlord|professional|person

party_spelling(id, party_id, spelling, spelling_norm, source, seen_count)
  -- every variant ever encountered; never deleted

project(id, company_id, name, kind, started_on, ended_on)
  -- "Jurong fit-out", "2022 signage change" — clusters related documents

alias(id, company_id, term, term_norm,
      target_type, target_id,
      source, confidence,
      first_used_on, last_used_on, use_count,
      created_by_user_id)
  -- target_type: party|project|doc_type|place|asset
  -- source: harvested|confirmed|derived
  -- THE VOCABULARY LAYER. first/last_used_on carry the drift.

anchor(id, company_id, phrase, phrase_norm, event_id,
       start_date, end_date, source, confidence)
  -- "before we moved shops" -> office_move -> window

index_term(id, document_id, term, term_norm, weight, source)
  -- source: extracted|caption|alias|party|ocr|filename
  -- the flat surface actually searched

query_log(id, company_id, user_id, raw_query,
          resolved_window_start, resolved_window_end,
          resolved_targets, result_count, corrected, at)
  -- every query is a learning opportunity; corrections feed `alias`
```

`document` gains: `caption`, `caption_by_user_id`, `captioned_at`,
`project_id`, `party_id`.

**Why `first_used_on` / `last_used_on` on alias matters:** it is what lets the
system answer *"you called these 'to pay' until 2021"* and search both eras
from one word. Without those two columns the drift problem is unsolved.

---

## 4. Workflow A — capture and index

**The design principle:** capture is the only moment when context is free.
She is holding the thing and knows what it is. In five years nobody will.
So spend *at most one cheap question* at capture, and never ask her to tag.

```
1. RECEIVE      file + who + when + channel
2. FINGERPRINT  sha256 → duplicate? stop.
3. TEXT         pdfplumber → OCR → (photo: EXIF date + GPS only)
4. CLASSIFY     haiku → lane + doc_type            [proposes]
5. EXTRACT      sonnet → typed fields + confidence [proposes]
6. RESOLVE      party: match spellings → existing party, or propose new
                project: date + party + open projects → propose
                                                     [deterministic + LLM]
7. VERIFY       arithmetic, dates, dupes, injection [deterministic, WRITES]
8. INDEX        write index_term rows from: extracted fields, party names
                and every known spelling, doc_type + all its aliases,
                caption words, filename                     [deterministic]
9. HARVEST      any new words she used → alias rows (source=harvested)
10. ASK         at most one question, only if it improves future retrieval
11. ARCHIVE     commit with provenance                      [WRITES]
```

### The one question

Ask only when the answer is not recoverable later:

| Situation | Ask | Why |
|---|---|---|
| Photo, no text | **"What is this? One line."** | the caption *is* the index — nothing else will ever identify this photo |
| New party, ambiguous | "Is 'acme a/c' the same as ACME Aircon Services?" | merges an entity permanently |
| Value below threshold | "Is it $327.00 or $32.70?" | correctness |

Never ask for a category, a folder or a tag. She won't, and the agent can
propose it anyway.

**The gateway has no vision — so for photos the caption is not a fallback, it
is the primary indexing mechanism.** That reframes the limitation into the
design. Say this plainly rather than apologising for it.

### When she doesn't answer

Still index: date, GPS, who submitted, and *what else was happening that week*
(the system knows). Weak but real. Then offer batch labelling later as a
**pleasant** activity, not a chore:

> *"15 photos from 2021 have no description. Want to name a few?"*

Scrolling old photos is nostalgic. That is the one moment the labelling
backlog becomes something she'd actually enjoy — and it is pure index
enrichment.

---

## 5. Workflow B — query, resolve, answer, learn

```
1. PARSE      split query into: time expression | entity mentions |
              doc-type words | free terms                      [LLM]
2. TIME       time expression → anchor table → date window
              unresolvable → ASK "roughly when was that?"      [deterministic]
3. ENTITY     mentions → alias + party_spelling → target ids   [deterministic]
4. TYPE       doc-type words → synonym set INCLUDING her historical
              aliases ("to pay" → invoice, used 2019–2021)     [deterministic]
5. SEARCH     filter index_term by window + targets, rank      [deterministic]
6. SHOW       render the RESOLUTION above the results:
              "Looking Feb 2021 – Aug 2022, for ACME Aircon.
               You called these 'to pay' back then."
7. LEARN      she corrects → write alias / anchor (source=confirmed)
              she accepts → bump use_count, extend last_used_on
```

Step 6 is not decoration. It is the trust mechanism *and* the learning hook —
she cannot correct what she cannot see. It is also the thing that makes this
visibly not keyword search.

### The demo beat this buys you

> Type **"to pay 2021"**. Get the 2021 invoices. The resolution line reads:
> *"You called these 'to pay' until 2021 — I've matched them to invoices."*
> Then: *"Try that on Google Drive."*

That is memory that improves — criterion #2, "explicit state/memory
management", demonstrated rather than claimed.

---

## 6. What makes this defensible

A chat model can read any document you hand it. It cannot:

- know which documents you hold, so it cannot tell you what is missing
- remember that you said "to pay" in 2019 and "invoice" in 2023
- resolve "before we moved shops" to a date range from *your* history
- get better at your vocabulary every time you search

All four are properties of **durable, company-scoped, learned state** — the
thing a chat session structurally does not have.

---

## 7. Information workflow — the whole picture

```
        ┌── capture (chat / app) ──┐
        │                          ▼
   people ──────────────► INGEST ──► canonical index (L1, L2)
        ▲                     │          │
        │                     ▼          ▼
        │              one question   vernacular index (L3)
        │                     │          ▲
        │                     ▼          │ learns
        │              events ──► obligations ──► THE CLOCK ──► nudge ──┐
        │                   └──► expectations ──► gaps                  │
        │                                                               │
        └───────────────── query ◄── resolution (L4, L5) ◄──────────────┘
                                          │
                                    audit log (every read, write, download)
```

Four loops, and each one feeds the next:
1. **Capture** enriches the index.
2. **Index** enables retrieval.
3. **Events** generate obligations and expectations.
4. **Query** enriches the vocabulary, which improves capture and retrieval.

Loop 4 closing back into loop 1 is what makes this a memory rather than a
database.

---

## 8. What to build now, what is a slide

**v1 — build in the sprint (roughly a day on top of ingest):**
- `party`, `party_spelling`, `alias`, `anchor`, `index_term` tables
- Aliases harvested from captions and from every correction she makes
- Query resolution as one LLM pass with the alias + anchor tables supplied as
  context — the corpus is small, so brute force is correct and cheap
- The resolution line shown above results, with a correction affordance
- One anchor seeded from a real event (the office move)

**v2 — pitch, don't build:**
- Automatic co-occurrence mining for derived aliases
- Embeddings / vector search (unnecessary at this corpus size — say so, it
  reads as judgment rather than omission)
- Cross-company vocabulary priors
- Batch labelling campaigns

Resist building v2. The v1 list already produces the "to pay 2021" demo beat,
which is the whole point.

---

## 9. Correction: the corpus is 100× bigger than I sized it for

> *"3 invoices today, 3 photos for the memory lane — that's 6 without touching
> anything else. 6 × 365 ≈ 2,200 a year."*

Correct, and it invalidates two things I wrote above.

| | Year 1 | Year 5 | Year 10 |
|---|---|---|---|
| Items | ~2,200 | ~11,000 | ~22,000 |
| Of which photos (~70%) | 1,540 | 7,700 | 15,400 |
| Photo storage @3 MB | 4.6 GB | 23 GB | 46 GB |

**What this breaks:**

1. **"Brute-force over metadata, no vector DB" was wrong.** 11,000 documents ×
   ~500 tokens is 5.5M tokens. It does not fit in a context window at any
   price. §8 is superseded by §10 below.
2. **The Story UI does not survive it.** Dots-per-item and "22 things" are toy
   numbers. 2,200 items a year needs bands and counts, not one mark per item.
3. **Storage.** 80 GB Lightsail SSD carries one company for roughly a decade
   and no more. Object storage is the production path — say so; we cannot use
   S3 in this competition, so the demo runs on local disk and the slide names
   the real answer.

---

## 10. Retrieval at 11,000 documents

Your instinct is right: **the LLM helps you form the search — it is not the
search.** That is the correct architecture, not a compromise.

```
her words
  │
  ├─[1] PLAN      haiku → structured query            LLM   ~200 tok
  │                {terms, date_from, date_to, lane, party}
  ├─[2] EXPAND    alias + anchor tables → add her old words,
  │               resolve landmarks to a window        SQL
  ├─[3] FILTER    date / lane / party / project        SQL   indexed
  ├─[4] SEARCH    SQLite FTS5, BM25 over text+captions SQL   <50 ms
  ├─[5] RERANK    sonnet over the top ~20 snippets     LLM   ~2k tok
  ├─[6] ANSWER    resolution line + citations
  └─[7] LEARN     corrections → alias / anchor
```

Two bounded LLM calls. Deterministic search does the heavy lifting. SQLite
FTS5 handles millions of rows on this hardware without breaking a sweat.

### Do we need vector search? No — and say why

The gateway exposes `sonnet4.5`, `sonnet`, `haiku` and **no embeddings
endpoint**. Vectors would mean a local embedding model on the Lightsail box.
Feasible, but unnecessary here:

- FTS5 covers lexical matching
- the alias layer covers vernacular
- the anchor layer covers relative time
- rerank covers phrasing

Embeddings only add value for pure-concept queries with no shared words
(*"that thing about the roof leaking"*). Put it on the roadmap and state the
reasoning — declining a fashionable dependency with a reason reads as
judgment to an engineering panel, not as an omission.

### Photos: cluster, then caption the cluster

1,540 photos a year cannot each be captioned. But photos arrive in **bursts** —
same day, same place, same subject. So:

```sql
photo_cluster(id, company_id, started_at, ended_at, place,
              caption, caption_by_user_id, cover_document_id, item_count)
```

Cluster on `(date proximity, GPS proximity, submitter)`. 1,540 photos collapse
to roughly **200 clusters a year** — and captioning 200 things a year is
plausible where captioning 1,540 is not.

This is the fix for both problems at once:
- **Indexing:** one caption indexes fourteen photos
- **UI:** Story shows *"Foundation dug · 14 photos"* as one row, not fourteen

### UI consequences

- Year row: `2026 · 1,847 things` with a **twelve-month bar strip**, not dots
- Month drill: clusters and documents, never raw photo lists
- A cluster opens into a grid
- Missing items stay prominent precisely because they are rare — a handful
  against thousands
