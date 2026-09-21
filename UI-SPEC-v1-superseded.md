# UI specification — JagaOS

Written for: implementers, human or agent. Normative. Where this contradicts
a screenshot, this document wins. Diagrams: DIAGRAMS.md. System: ARCHITECTURE.md.

---

## 0. Principles

1. **Time is the primary axis.** Every screen answers *when*, then *what*.
2. **Gaps are as visible as holdings.** A missing document must be drawn, not
   listed in a report nobody opens.
3. **Every machine claim carries its receipt.** Any extracted value is one
   click from the characters it came from.
4. **The seam is visible.** Where the system stopped and asked a human is a
   feature we show, not an embarrassment we hide.

---

## 1. Design tokens

```css
:root{
  /* lanes — chosen to remain distinguishable in deuteranopia */
  --lane-statutory:#3b5bdb;  /* indigo  */
  --lane-invoice:  #0b7285;  /* teal    */
  --lane-document: #b8862b;  /* amber   */
  --lane-memory:   #a3276b;  /* magenta */

  --gap-stroke:#c92a2a;      /* dashed outline only, never filled */
  --today-line:#212529;

  --risk-high:#c92a2a; --risk-med:#e8893c; --risk-low:#2f9e44;

  --bg:#ffffff; --surface:#f8f9fa; --border:#dee2e6;
  --text:#212529; --text-muted:#6c757d;

  --space:8px;               /* all spacing is a multiple */
  --radius:6px;
  --font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, monospace;
}
```

Dark mode redefines `--bg #16181c`, `--surface #1f2227`, `--border #343a40`,
`--text #e9ecef`; lane hues lighten ~12%. Never signal state by colour alone —
pair every colour with a glyph or label (WCAG 1.4.1).

**Lane glyphs**, used everywhere a lane appears:
`▣ Statutory · ▤ Invoices · ▢ Documents · ◈ Memories · ⬚ Gap`

---

## 2. Shell

```
┌──────────────────────────────────────────────────────────────────────┐
│ JagaOS   ACME PTE LTD · UEN 2021xxxxx · FYE 31 Dec      [◐] [⚙] [?]   │
├────────┬─────────────────────────────────────────────────────────────┤
│ ▸ Time │                                                             │
│ ▸ Rev 3│                     route outlet                            │
│ ▸ Ask  │                                                             │
│ ▸ Pack │                                                             │
│ ▸ Trace│                                                             │
└────────┴─────────────────────────────────────────────────────────────┘
```

Sidebar collapses to a bottom bar below 768px. **Review** shows a count badge;
if any item is `quarantined` the badge turns `--risk-high` and carries `!`.

Routes: `/` timeline · `/review` · `/review/:id` · `/doc/:id` · `/obligation/:id`
· `/ask` · `/pack` · `/trace/:runId` · `/settings`

---

## 3. Screen 1 — Timeline (hero)

**Route** `/` — **Purpose:** the thesis in one screen. Past evidence and
future obligations on a single axis, with holes drawn.

```
  ┌─ Zoom: [Year] Quarter Month ──────────── Lanes: ▣ ▤ ▢ ◈ ─ [Gaps ✓]─┐
  │                                                                     │
  │        PAST — evidence              │TODAY│    FUTURE — obligations │
  │  2021   2022   2023   2024   2025   │ 2026│   2027                  │
  │ ▣ ██    ██     ⬚⬚     ██     ████   │ ██  │  ○ AGM          30 Jun  │
  │ ▤ ███   ██     █      ███    ██     │ ███ │  ○ Annual Return 31 Jul │
  │ ▢ █     ⬚      ██     █      ██     │ █   │  ○ Form C-S     30 Nov  │
  │ ◈ ████  ██     █      ████   ███    │ ██  │                         │
  │                                     │     │                         │
  │  ⬚ = expected, not held — 3 gaps    │     │  ○ = open  ● = overdue  │
  └─────────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Contract |
|---|---|
| `<TimelineAxis>` | `zoom: 'year'\|'quarter'\|'month'`, `range`, `todayIndex` |
| `<LaneRow>` | `lane`, `buckets: Bucket[]`, `onSelect(bucket)` |
| `<Bucket>` | `count`, `gapCount`, `lane`, `period` — filled block sized by count, **plus** a dashed outline block per gap |
| `<ObligationPin>` | `obligation`, `status`, `risk` — right of the today line |
| `<TodayMarker>` | vertical rule, label `TODAY`, sticky while scrolling |
| `<GapLegend>` | totals: `n documents · m gaps · k obligations open` |

### Behaviour

- Click a bucket → right drawer lists its documents. Does not navigate away.
- Click a **gap** → drawer explains *why it is expected*: the event, the rule
  id, the document type, and an `Upload it` / `Mark not applicable` pair.
- Click an obligation pin → `/obligation/:id`.
- Zoom `Year → Quarter → Month`; a 5-year archive must never be an infinite
  scroll. Preserve the focused period across zoom changes.
- Lane toggles filter rows. `Gaps` toggle hides dashed blocks.
- Horizontal scroll is keyboard reachable: `←/→` move period, `↑/↓` move lane,
  `Enter` opens the drawer.

### States

| State | Render |
|---|---|
| Loading | skeleton lanes, axis visible, no spinner-only screen |
| Empty — new company | "Nothing captured yet." Primary CTA `Forward your first document`. Future obligations **still render** — they come from the profile, not from documents. This is the moment the product explains itself. |
| Error | inline banner, retry, keep last good render |

**Acceptance:** with zero documents and a configured FYE, at least three future
obligations are drawn. If the empty timeline is blank, the build is wrong.

---

## 4. Screen 2 — Review queue

**Route** `/review` — the human-in-the-loop surface, and the demo's proof that
autonomy is risk-calibrated.

```
┌ Needs you — 3 ──────────────────────────────────────────────────────┐
│ ⚠ QUARANTINED  invoice_acme_0413.pdf                                │
│    Contains text addressed to the system.          [Triage →]       │
├─────────────────────────────────────────────────────────────────────┤
│ ? LOW CONFIDENCE  receipt_scan_88.jpg        total 0.42             │
│    Is the total 327.00 or 32.70?                   [Resolve →]      │
├─────────────────────────────────────────────────────────────────────┤
│ ? NO TEXT  IMG_2291.HEIC · 12 Mar 2021 · 1.3°N 103.7°E              │
│    What is this? One line.                         [Caption →]      │
└─────────────────────────────────────────────────────────────────────┘
```

Item kinds: `quarantined` · `low_confidence` · `ambiguous` · `arithmetic_mismatch`
· `awaiting_caption` · `duplicate_suspected`. Sort: quarantined first, then
oldest. Each row states **the question**, never just "review needed".

### Resolve view `/review/:id`

Split pane. **Left:** source document, the contributing span highlighted from
`extraction.char_start/char_end` (or page bbox). **Right:** the proposal, each
field with its confidence, editable. Buttons: `Confirm` · `Correct & confirm`
· `Reject` · `Not applicable`.

Footer, always visible: *"JagaOS proposed this. Nothing is filed until you
confirm."*

**Acceptance:** confirming writes `extraction.source='human'`, resumes the
suspended graph run via `resume(run_id, decision)`, and appends a `trace` row
with `node='human_review'`.

---

## 5. Screen 3 — Document detail

**Route** `/doc/:id`

Header: filename · lane chip · doc_type · occurred_on · source channel ·
`status`. Tabs:

- **Fields** — table `field · value · confidence · source`. Confidence renders
  as a bar plus the number; `source` is `model` or `human`. Click a row to
  highlight its span in the preview.
- **Preview** — rendered PDF/image with highlight overlay.
- **Links** — the thread: quote → invoice → warranty → repair photo → claim.
  Also: obligations this document evidences, expectations it satisfies.
- **Trace** — embedded `<TraceTable>` for this document's run.

---

## 6. Screen 4 — Obligation detail

**Route** `/obligation/:id`

```
AGM — FY2026                                    status: notified · T-30
Due 30 Jun 2026 · lead 60 days · risk HIGH
Rule  SG.ACRA.AGM.PRIVATE.6M      ← link to the rule source
Why   FYE 31 Dec 2025, from BizFile profile p.1  ← citation, clickable
Evidence  none yet          [Attach evidence]  [Mark not applicable]
Ladder  T-60 sent 1 May · T-30 sent 31 May · T-7 pending
```

Every obligation shows **which rule produced it and which document supplied the
input**. An obligation without a citation is a bug.

Footer disclaimer, non-dismissable: *"JagaOS tracks deadlines from your
documents. It is not legal or accounting advice — confirm with your corporate
secretary."* This is a scored item under Safety & Guardrails, not boilerplate.

---

## 7. Screen 5 — Handover pack

**Route** `/pack` — the headline demo.

```
Corporate Secretary Handover Pack
Generating…  ████████████░░░  14 of 19 found

HELD (14)                          MISSING (5)
✓ Constitution                     ⬚ AGM minutes FY2023
✓ BizFile profile (12 Sep 2026)    ⬚ Register of controllers (RORC)
✓ Register of members              ⬚ Share certificate — [director]
✓ Annual Return FY2024             ⬚ Board resolution — corp sec change
…                                  ⬚ Financial statements FY2023

        [Download pack .zip]   [Email the list to my corp sec]
```

Zip contains the held documents in a numbered folder structure plus
`MANIFEST.md` listing held **and missing** items with the rule that expects
each. The missing list is the product. Do not hide it behind a tab.

---

## 8. Screen 6 — Ask (recall)

**Route** `/ask`

Single input. Suggested prompts seeded from real events:
*"the foundation photos — before we changed the signage"*,
*"what did we pay for aircon last year"*, *"invoices from 2020"*.

Answer renders as: resolved window (`anchor: office_move, 14 Aug 2022 →
searched Feb 2021 – Aug 2022`), then result cards with thumbnail, date, lane,
and a citation link. Always show the **resolution step** — that is what
distinguishes this from search.

If the anchor cannot be resolved, ask a clarifying question rather than
guessing. Never return a confident empty answer.

---

## 9. Screen 7 — Agent trace

**Route** `/trace/:runId` — the "Show Me Your Agents" screen.

```
run 8f2a · invoice_acme_0413.pdf · 6 nodes · 4.2s · $0.0041

 node                model      in    out   conf   decision
 ingest              —           —     —      —    sha256 new · pdfplumber
 classify            haiku     412    28   0.96   lane=invoice
 extract             sonnet   1,204   190  0.91   7 fields
 verify              —           —     —      —    GST ✓ dates ✓ dup ✓
 derive_events       sonnet     380    64  0.88   none proposed
 derive_obligations  —           —     —      —    2 created

 [▸ expand any node to see the exact prompt and response]
```

Requirements: every node row present even when it made no model call;
per-node token counts and cost; a **footer total in SGD and USD**; expandable
raw prompt/response with the untrusted-content delimiters visible. Judges will
look for the delimiters — make them easy to find.

---

## 10. Screen 8 — Settings / company profile

**Route** `/settings` — UEN, company name, incorporation date, FYE (month +
day), GST registered + period, dormant flag, notification contacts (primary +
escalation), retention period (default 5 years, cites IRAS), data location
note. Changing FYE **recomputes obligations** and shows a diff before saving.

---

## 11. API surface

```
POST   /api/ingest                 multipart: file, source_channel  → {document_id, run_id}
GET    /api/timeline?zoom&from&to  → {lanes:[{lane,buckets:[{period,count,gaps}]}], obligations:[…]}
GET    /api/documents/:id          → document + extractions + links
GET    /api/documents/:id/file     → bytes
GET    /api/review                 → review_item[]
POST   /api/review/:id/resolve     {decision, corrections} → resumes the run
GET    /api/obligations            ?status → obligation[]
GET    /api/obligations/:id        → obligation + rule + citation + ladder
POST   /api/obligations/:id/evidence {document_id}
GET    /api/expectations           ?status=missing → the gap list
POST   /api/pack/generate          → {pack_id, held[], missing[]}
GET    /api/pack/:id/download      → zip
POST   /api/ask                    {question} → {window, anchor, results[]}
GET    /api/trace/:runId           → trace[]
GET    /api/company  ·  PUT /api/company
GET    /api/health                 → deployment evidence endpoint
```

All responses typed with Pydantic and mirrored into TS via generated types —
do not hand-write the client interfaces.

---

## 12. Accessibility & responsive

- Keyboard reachable on every interactive element; visible focus ring.
- Colour never the sole signal — lane glyph or text label always present.
- Contrast ≥ 4.5:1 for text, ≥ 3:1 for the timeline blocks against `--bg`.
- Timeline below 768px: lanes stack, horizontal scroll with snap, today marker
  sticky. No horizontal page scroll.
- `prefers-reduced-motion` disables the timeline pan animation.

---

## 13. Demo-critical checklist

The five moments the video must show. Build these first if time is short.

1. Empty timeline that **already shows future obligations** — the product
   explaining itself before any data exists.
2. A gap clicked open, showing the rule that expects the missing document.
3. The blurry receipt routed to review, beside ChatGPT confidently guessing.
4. The injected invoice quarantined, obligations visibly unchanged.
5. The handover pack generating, missing list on screen.
