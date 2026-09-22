# The moat question: why not just use ChatGPT?

Written for: the team. The answer we must survive on stage.

## Concede first

Document extraction is **commodity**. Any free-tier chat model reads an invoice
and returns vendor, amount, GST, date. It will also tell you the AGM deadline
if you tell it your FYE. If our pitch leads with "we extract fields with AI,"
we lose — a judge opens ChatGPT on their phone and we are finished.

So extraction is not the product. It is the cheapest part.

## The structural gaps (properties of the form factor, not the model)

A better model closes none of these. That is the test.

**1. Chat has no clock.**
It is pull-only. It cannot wake up. The dormant-company failure mode is not
"couldn't compute the date" — it is *nobody thought about it on 28 June*.
No model capability fixes a question that is never asked.

**2. Chat has no durable ledger.**
Every session is an island. No accumulating state, nothing to reconcile,
no "what is outstanding right now" that survives closing the tab.

**3. Chat has no refusal discipline.**
Feed it a blurry GST number and it returns a confident wrong one. No
confidence threshold, no human review queue, no deterministic arithmetic
check (line items → subtotal → GST → total), no duplicate detection.

**4. Chat produces no provenance.**
IRAS requires records for **5 years**. A chat transcript is not a record.
We need: field → source page region → extraction timestamp → verifier rule →
who confirmed it. Hand that to an auditor; you cannot hand them a chat log.

**5. Chat outputs prose, not artifacts.**
You still have to create the calendar entry, the folder, the CSV, the
director's pack. The last mile is exactly where compliance actually dies.

**6. Wrong data posture, wrong number of people.**
One private session. The corp sec, bookkeeper and auditor cannot see it.
Consumer free tiers train on what you paste — vendor pricing, staff records,
customer lists. PDPA exposure for zero benefit.

## The one-liner

> **ChatGPT answers questions. Ours asks them — on the right day, whether or
> not anyone is paying attention.**

An agent is defined by acting when nobody is in the room. Everything else in
the build supports that sentence.

## The expected counter, and the answer

*"So it's a database, a scheduler and an LLM."* — Correct, and that is the
point. The model is the commodity; the accountability layer is the product.
That is the same thesis the AWS and DBS judges sell for a living.

## "Isn't this just Siri now?" (added 2026-09-21)

Apple's Siri AI (public launch fall 2026) is the most credible near-term
counter, and it will come up — judges follow Apple keynotes. Get the facts
right before using this on stage: Siri AI runs on iPhone, iPad, **and Mac
(M1 or later)**, plus Vision Pro and Watch — it is **not** phone-only. Do not
claim a device restriction that a judge can disprove by opening their MacBook.
The real gaps are structural, same pattern as the ChatGPT answer above:

1. **Single user, tied to one Apple ID.** Siri is a personal assistant. It
   has no concept of a company: no shared queue between a director and their
   co-director, no per-document attribution, no activity log an auditor can
   read. JagaOS's multi-user model (`WINNING.md` Part 3) is company-shaped;
   Siri's is person-shaped.
2. **No compliance-grade provenance.** Siri can read what's on your screen
   in the moment. It does not keep a 5-year, field → source → verifier
   record an auditor or IRAS will accept (`MOAT.md` point 4, above). Screen
   understanding is not a ledger.
3. **No statutory obligation model.** Siri acts on context you show it or
   ask about; it does not derive a company's Annual Return / AGM / Form C-S
   deadlines from its constitution and FYE and hold them on a clock with an
   escalation ladder. It has never heard of s155.
4. **Platform lock-in, the SME's problem not ours.** Siri AI requires recent
   Apple hardware across the org (M1+ Macs, iPhone 15 Pro+). A Singapore SME
   with a Windows PC and an Android phone at the front desk is locked out
   entirely. JagaOS is a web app plus a Telegram bot — any device, and it
   runs on the company's own AWS, not Apple's cloud.
5. **No gap analysis.** Even with perfect on-device recall, Siri cannot tell
   you which of nineteen expected documents you don't have, because nothing
   defines the expected set for a Singapore company. That is still our
   moat sentence, unchanged by this launch.

One-line version for the pitch, if asked: *"Siri knows what's on your
screen. It doesn't know what your company is missing — and it doesn't take
minutes when your Annual Return is due and everyone's asleep."*

## Dormant is an asset, not an excuse

Our SME is dormant. Do not hide it — it is the **purest instance of the
problem**: nothing is happening, so nobody is watching, but the statutory
clock never stopped.

Verified obligations that survive dormancy:

- **Annual Return still due** within 7 months of FYE — dormancy changes nothing
- AGM **may** be dispensed with if all members agree — the AR is still due
- Financial statements may be exempt under s201A — the AR is still due
- **IRAS: still file Form C-S/C** unless a waiver has been granted

And the consequences are not $600:

- **s155** — 3+ filing convictions in 5 years → **5-year disqualification**
- **s155A** — director of 3+ companies struck off in 5 years for non-filing →
  automatic **5-year disqualification**
- **Debarment** — filings outstanding 3+ continuous months → cannot take on
  new directorships until cleared

> The penalty isn't $600. It's your name.

That is the business case. Personal, verifiable, and every judge on the panel
sits on boards.

## The soft spot, and how we handle it

A dormant company is a weak *dollar* story. Expect: "what's the ROI on $600?"

Answer in two moves:
1. The exposure is tail risk, not the fine — disqualification and debarment.
2. Dormant is the proof case; the market is **lean SMEs with no finance
   function** (the majority of SG companies), where the same engine runs on a
   fuller document set. We demo the hardest-to-notice case.

Do not oversell TAM. Sell the sharpness of the wedge.

## The two demo beats that win the room

**Beat 1 — the refusal.** Same blurry invoice, side by side. ChatGPT returns a
confident wrong GST number. Ours says: *"GST reg. number unreadable — confirm?"*
and holds it in the review queue. 15 seconds. Run it honestly, unrigged.

**Beat 2 — close the laptop.** "Now I do nothing for four months." Cut to the
message arriving on the phone. Nobody opened an app. That is the agent.

## Responsible-design note (scores under "secure & responsible")

Every obligation cites its source and is framed as a prompt to verify with
your corporate secretary — never as legal advice. Build that into the output
format from day one; it is a scoring line, not a disclaimer.

## Revised scope

Lead with the **obligation engine**. Invoices demote from headline to
**evidence layer** — attached to obligations for 5-year retention and GST
support. With a dormant SME we have few invoices, and that is fine: quality of
handling beats volume.

Build order:
1. Company profile intake (BizFile profile → FYE, directors, corp sec, inc. date)
2. Obligation graph derivation, each date cited to its source
3. Scheduler + escalation ladder (T-60 / T-30 / T-7 / T-1 → second contact)
4. Push channel (Telegram for the sprint; WhatsApp Business API is a
   transport swap in production — say so, don't fake it)
5. Evidence capture + verifier + human review queue
6. Agent trace panel with per-document cost

## Name

**JagaOS** — Malay/Singlish, "to guard / watch over." Local, warm, and literally
what it does. Alternatives: Kiasu (bolder), Sentry (safe).
