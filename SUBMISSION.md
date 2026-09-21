# Submission plan

Written for: the team. Working checklist.
Deadline: **28 September 2026, 09:00** — posted to the Slack #submission
channel. Incomplete submissions "may be rejected" (their words), so format
compliance is a gate, not a nicety.

---

## 1. The six required fields

Post as one message, in this order:

- [ ] **Team Code** — `E270203Z`
- [ ] **Project Name** — JagaOS
- [ ] **GitHub Repo (URL)** — public, README, `evals/report.md` committed
- [ ] **Video** — YouTube or MP4 download link (duration: 30 min)
- [ ] **Write-up document (PDF)**
- [ ] **Deployment evidence / URL** — the live Lightsail instance

Separately, before the same deadline:
- [ ] **Proposal form** submitted (QR in the briefing deck)

**Ask on Slack now, not on the 27th:**
- [ ] Is 30 minutes a maximum or a target?
- [ ] Does deployment evidence mean a live URL, or screenshots?
- [ ] Is the USD 100 AWS credit per team or per participant?

---

## 2. The write-up PDF

Judged on five criteria from the proposal guidelines. One section each, in
their order — do not invent your own structure.

### 1. Problem & Opportunity
Who, what, why it matters, current situation. Lead with the true story:
nineteen documents requested, fourteen held, five unknown. Their guidance
explicitly warns against *"we want to build an AI chatbot"* and asks for a
process description — so describe the weekend of digging, not the technology.

### 2. Business Value
Map to their six value types. Ours are:
- **Risk** — missed statutory deadlines; s155 disqualification exposure
- **Productivity** — the handover weekend, eliminated
- **Cost** — penalties avoided, GST input tax preserved, grant claims
  substantiated

Name the two halves explicitly (INDEXING.md §0): the obligation engine is the
recurring value, the archive is the catastrophic-avoidance value.

### 3. Impact & Outcomes
They want KPIs with numbers. Use measured ones from your own backlog run, not
projections:
- documents indexed, and hours it would have taken by hand
- obligations surfaced that were not previously tracked
- gaps found against the corp sec checklist — *"14 of 19"*
- retrieval time: minutes → seconds, measured
- cost per document in SGD

### 4. Feasibility & Scalability
Data needed, AWS platform, human-in-the-loop, deployment, risk. Then
scalability — and this is where the **corporate secretary channel** goes: one
firm carries 50–300 small companies with this exact pain. That is the answer
to "how does this reach SG SMEs".

### 5. Proposal Quality
Clear, concise, evidence-based, consistent, stakeholder-aware. Every claim
that can be shown, is shown in the video.

---

## 3. Claim ↔ evidence table

Their slide 10 says proposal and demo must tell the same story. Build this
table, put it in the PDF, and make every row true.

| Proposal claim | Video timestamp | What is shown |
|---|---|---|
| Sorts and files without being asked | 02:00 | Telegram photo → filed |
| Asks when unsure rather than guessing | 04:10 | the $327 / $32.70 question |
| High-risk changes need a human | 09:30 | waiver blocked for non-directors |
| Resists hostile documents | 11:00 | injection quarantined, obligation untouched |
| Knows what you are missing | 18:00 | 14 of 19, with the rule for each |
| Acts when nobody is present | 22:00 | four months pass, message arrives |
| Learns your vocabulary | 20:00 | "to pay 2021" resolves |
| Costs cents per document | 24:30 | trace footer |

---

## 4. Video plan

Chapters are in WINNING.md §4. Rules:

- **Record the loop unedited and in one take.** Cuts read as concealment.
- Chapter markers in the YouTube description — judges will skip.
- Show the eval scorecard on screen, not described.
- Show the live URL being loaded in a browser, not a screenshot.
- State plainly which data is real and which is the labelled demo corpus.
  Being upfront reads as credibility; being caught does not.

---

## 5. Repo checklist

- [ ] Public, MIT or Apache-2.0
- [ ] README: what it is, the architecture diagram, how to run, the gateway
      finding (text-only, native tool calling works)
- [ ] `evals/report.md` committed with the scorecard
- [ ] `docs/` carrying ARCHITECTURE, DIAGRAMS, INDEXING, PLATFORM
- [ ] **No secrets.** `git log -p | grep -i "api.softwaresystems\|1b919d3"`
      before you make it public — the team key is in the kickoff screenshots
      and must not reach the repo
- [ ] `.env.example`, never `.env`

---

## 6. Dates

| When | What |
|---|---|
| Now | Slack questions asked; Lightsail box up with TLS |
| Build days | ingest → classify → extract → verify → obligations → gaps |
| Freeze | feature freeze; only bug fixes after this |
| Then | eval suite, guardrails, trace, backlog run on real documents |
| **25 Sep** | build phase ends; video recorded |
| 26–27 Sep | PDF final, repo cleaned, rehearse |
| **28 Sep 09:00** | submit — aim to post the evening before |

**Do not aim for the deadline. Aim for the evening of the 27th.** A 09:00
deadline means a morning upload failure ends your competition.

---

## 7. If shortlisted

Finale is **10 October 2026, 08:30, face to face.** Five teams per category.
Different job from the video: short, live, and they will ask hard questions.

Prepare answers for:
- "Isn't this Google Drive?" → it can't tell you what's missing
- "What's the ROI for a dormant company?" → INDEXING.md §0, both halves
- "What stops the AI getting it wrong?" → LLM proposes, code disposes
- "Who pays, and how much?" → per company, never per seat; corp sec channel
- "What happens when you two lose interest?" → it runs on their own AWS, data
  exportable, no lock-in
