# UI specification v2 — mobile first

Written for: implementers, human or agent. Normative.
**Supersedes UI-SPEC-v1-superseded.md**, which was a desktop analyst console
mistaken for a product. Diagrams: DIAGRAMS.md. System: ARCHITECTURE.md.

---

## 0. The persona decides everything

> **Mei.** Runs a small company. Not technical. Does not want to learn a tool —
> wants to stop worrying about the filing so she can get on with the business.
> Opens this perhaps **eight times a year**, on her phone, usually standing up.

Three consequences, and every rule below follows from them:

**1. Every visit is a first visit.** Eight sessions a year builds no muscle
memory. Nothing may rely on remembered navigation, learned icons, or a
tutorial she saw in March. If a screen needs explaining, it is wrong.

**2. The answer must arrive before the interface does.** She opens the app to
learn one thing: *am I okay?* That answer is the first thing on screen, in
words, at a size she can read at arm's length. Not a chart she has to
interpret. Not a number she has to compare to another number.

**3. The chat thread is the primary interface; the app is secondary.** She
forwards a photo to a chat and gets a plain reply. She gets a nudge months
later and replies to it. Most of her year happens in the message thread and
she never opens the app at all. **Design the message first, the screen
second.** This also sharpens the pitch: we are not replacing chat — we are
giving chat a clock and a memory.

### Two surfaces, and only one of them is the product

The engineering rubric wants traces, confidence, evals, provenance. Mei wants
none of that and must never be shown it.

| Surface | For | Where |
|---|---|---|
| **Owner surface** | Mei | the app and the chat thread |
| **Inspection surface** | judges, auditors, us | `/inspect`, reachable from a document's "See how I read this", never in the nav |

Do not merge them. "The SME owner never sees an agent — that's the point" is a
stronger thing to say to an engineering judge than a busy console is to show
them. The trace still exists, still scores, and still sits one tap away.

---

## 1. Mobile-first rules — non-negotiable

Design at **390 px**. Let it breathe on desktop; never design the desktop and
shrink it.

- **One column. Always.** No side-by-side panes at any width below 900 px.
- **Primary action lives at the bottom**, inside the thumb arc. Never a primary
  action in the top bar.
- **Three nav destinations, maximum.** Bottom bar. Labelled in words, not icons
  alone — she will not learn our icons in eight visits.
- **Body text 16 px minimum** (also stops iOS zooming on focus). Status text
  larger.
- **Tap targets ≥ 44 × 44 px**, with ≥ 8 px between them.
- **No tables. No horizontal scroll. Anywhere.** If data needs a table, it
  belongs on the inspection surface.
- **One question per screen** when we need something from her.
- **Capture is one tap from everywhere** — a persistent camera button.
- Everything works one-handed.

---

## 2. Language

The vocabulary in ARCHITECTURE.md is for the codebase. None of it reaches Mei.

| In the code | On her screen |
|---|---|
| obligation | what's due |
| expectation, gap | missing |
| lane | *(just name the thing: Filings, Bills, Documents, Photos)* |
| confidence below threshold | "I'm not sure I read this right" |
| quarantined | "This looks off — I didn't file it" |
| review queue | **Needs you** |
| provenance, citation | "Where I got this" |
| trace, run, tokens | *(never shown)* |
| human-in-the-loop | *(never shown)* |
| derive / verify / extract | *(never shown)* |

**Test for every string:** could she answer or act on it without looking
anything up? *"Is the total $327.00 or $32.70?"* passes. *"Confirm extraction
for gst_reg_no"* fails.

Never make her feel stupid, and never make her feel accused. The system was
unsure; she is the one who knows.

---

## 3. Information architecture

```
  ┌─────────────────────────┐
  │  status + what's next   │   Home
  │  needs-you cards        │
  │  recent                 │
  └─────────────────────────┘
   ┌──────┬────────┬───────┐
   │ Home │   ＋   │ Story │      ← bottom bar, 3 targets
   └──────┴────────┴───────┘
```

- **Home** — am I okay, what's next, what needs me
- **＋** — capture: camera, photo library, file. Centre, raised, always there
- **Story** — scroll back through the years
- **Ask** — *not* a tab. A search field pinned at the top of Story, because
  asking is always about the past

"Needs you" is not a destination. If two things need her, they are **on Home**,
at the top. She should never have to go looking for work.

Routes: `/` · `/story` · `/story/:year` · `/needs/:id` · `/capture` · `/ask`
· `/thing/:id` · `/pack` · `/settings` · `/inspect/:runId` *(hidden)*

---

## 4. Screen — Home

**The whole screen answers one question before she reads anything else.**

```
┌────────────────────────────────┐
│ Kinta Works              ⚙     │
│                                │
│         ✓                      │   ← status mark, 56px
│    You're on track             │   ← 26px, Fraunces
│    Nothing due for 3 months    │   ← 16px, muted
│                                │
│ ┌────────────────────────────┐ │
│ │ NEXT                       │ │
│ │ Annual Return              │ │
│ │ 31 July 2027 · in 318 days │ │
│ └────────────────────────────┘ │
│                                │
│ Recently filed                 │
│ · Aircon service bill   Mar 26 │
│ · Corp sec renewal      Aug 26 │
│                                │
└────────────────────────────────┘
        Home    ＋    Story
```

**Not-okay state** replaces the hero, same position, same size:

```
         ⚠
    2 things need you

  ┌────────────────────────────┐
  │ Is this total $327.00      │
  │ or $32.70?                 │
  │ Aircon bill · 14 Mar   →   │
  └────────────────────────────┘
  ┌────────────────────────────┐
  │ What's this photo?         │
  │ 12 Mar 2021            →   │
  └────────────────────────────┘
```

### Rules

- Exactly **one** status: `on track` · `needs you` · `overdue`. Never two.
- Status is a word **and** a mark **and** a colour. Never colour alone.
- The next due thing shows the **date and the countdown in days**. A date alone
  makes her do arithmetic.
- Needs-you cards show **the question**, never the file name first.
- Maximum three recent items, then "See all" into Story.
- **Empty state still shows what's coming.** A brand-new account with zero
  documents must still say "Annual Return, 31 July 2027". The obligations come
  from her company profile, not from her documents. This is the moment the
  product explains itself, and it is a build acceptance criterion.

---

## 5. Screen — Story

Her business, scrolling backwards. This is the half of the product she will
actually enjoy, so it should feel like a photo app, not a filing system.

```
┌────────────────────────────────┐
│ 🔍 Ask about anything          │   ← pinned; tap opens /ask
├────────────────────────────────┤
│                                │
│  2026                          │   ← Fraunces, 30px
│  8 things · this year          │
│  ▢▢▢ ▣▣ ◈◈                     │   ← small, quiet, decorative
│                                │
│  2025                          │
│  6 things                      │
│                                │
│  2024                          │
│  9 things · 1 missing          │   ← the only place red appears
│                                │
│  2021                          │
│  22 things · the first year    │
│  [photo][photo][photo]         │   ← thumbnails when a year has photos
│                                │
└────────────────────────────────┘
```

Tap a year → `/story/:year`: months down the page, each item a row with a
thumbnail, name and date. Photos render as photos, not as file icons.

### Rules

- **Vertical scroll, newest first.** No horizontal timeline on mobile, ever.
- Years with photos show up to three thumbnails. This is what makes her scroll.
- A missing item appears **in place, in the month it belongs to**, as a dashed
  row: *"AGM minutes — I'd expect this here"* with a tap target to upload or
  dismiss. Do not hide gaps behind a filter, and do not make a whole separate
  screen for them.
- Category filter is a single row of chips, collapsed by default. Off by
  default means the first thing she sees is everything, in order.

---

## 6. Screen — Needs you (one question, full screen)

```
┌────────────────────────────────┐
│ ←                        1 of 2│
│                                │
│  [ receipt photo, tappable ]   │
│                                │
│  I couldn't read the total     │   ← 22px
│  clearly.                      │
│                                │
│  Is it:                        │
│  ┌────────────────────────────┐│
│  │  $327.00                   ││   ← 56px tall, 18px type
│  └────────────────────────────┘│
│  ┌────────────────────────────┐│
│  │  $32.70                    ││
│  └────────────────────────────┘│
│                                │
│  Something else →              │
│                                │
│         Skip for now           │   ← bottom, quiet
└────────────────────────────────┘
```

### Rules

- **One question per screen.** Never a form.
- Offer **choices, not a text field**, whenever the system can propose options.
- The source image is on screen and tappable to zoom — she should never have to
  find the original to answer.
- `Skip for now` always available and never punished.
- After the last one: *"That's everything. Nothing else needs you."*
- No confidence scores, no percentages, no field names.

---

## 7. Screen — Ask

One field, voice input beside it, and three real example questions as tappable
chips — she will not invent a query on her own the first time.

```
  🔍 ┌──────────────────────────┐ 🎤
     │ Ask about anything       │
     └──────────────────────────┘

  Try:
  ( photos from when we started )
  ( what did we pay for aircon )
  ( invoices from 2021 )
```

Answer shows results as cards with thumbnail, name and date. Above them, one
plain line of how it was understood: *"Looking in Feb 2021 – Aug 2022, before
you changed the signage."* That line is the difference between this and
search — keep it, but keep it in her words.

If the time reference can't be resolved, **ask her** rather than guessing:
*"Roughly when was that?"*

---

## 8. Screen — Handover pack

One button. Then two lists, held and missing, missing first because it is the
part she has to act on.

```
  Someone asking for your records?

  [  Put together a pack  ]        ← full width, bottom

  ──────── after ────────

  14 of 19 found
  ████████████░░░

  You'll need to find 5            ← first, not second
  ⬚ AGM minutes 2023
  ⬚ Register of controllers
  ...

  Already in the pack (14)  ▾      ← collapsed
```

Plain-language subtitle under each missing item: *"Your corporate secretary
will ask for this."* Not the rule id — that lives on the inspection surface.

---

## 9. The message thread — design this first

Most of her year is here. Every message: **plain sentence, no jargon, one
action if any.**

**Filed:**
> Filed your aircon bill — $327.00, 14 Mar. I've noted the warranty runs to
> 14 Mar 2027.

**Unsure:**
> I couldn't read the total on this one. Is it $327.00 or $32.70?
> `[ $327.00 ]` `[ $32.70 ]`

**No text in a photo:**
> Got the photo from 12 Mar 2021. What is it? One line is fine.

**Nudge:**
> Your Annual Return is due 31 July — that's 60 days.
> Nothing for you to do yet, I'll remind you again in a month.

**Escalation:**
> Annual Return due in 7 days. Late filing is $300, and it still applies even
> though the company is dormant. Want me to send the checklist?

**Suspicious document:**
> I didn't file this one — it has text in it telling me to mark your Annual
> Return as done. That's not something a real invoice does. Have a look?

Note the last one: it explains the threat in her terms and leaves the judgment
with her. No security jargon, no alarm.

---

## 10. Visual direction

Two halves of the product, two type voices — deliberate, not decorative.

- **Fraunces** for the warm half: the status line, year headings in Story. The
  business's own story deserves a face with character.
- **Figtree** for everything functional: labels, buttons, dates, body.
- Tabular numerals wherever dates or amounts stack.

Ground is a warm off-white, not clinical white. Green carries `on track` —
it is the state she is in almost all the time, so the app's resting mood is
reassurance. Amber for `needs you`. Red **only** for overdue and for missing
items; if red appears anywhere else, it stops meaning anything.

Category colours are quiet and recede — they are labels, not the point.
Generous spacing. Large touch targets. Nothing dense.

---

## 11. Accessibility

- Contrast ≥ 4.5:1 body, ≥ 3:1 large text and meaningful marks.
- Status never communicated by colour alone — word + mark + colour, always.
- Full keyboard reachability with a visible focus ring, for the desktop view.
- `prefers-reduced-motion` disables all transitions.
- Supports 200 % text zoom without clipping or horizontal scroll.
- Every image has alt text; document thumbnails use the document's own name.

---

## 12. Acceptance criteria

1. Every screen usable one-handed at 390 px with no horizontal scroll.
2. A new account with zero documents still shows at least one dated upcoming
   filing on Home.
3. Home states the status in **words** above the fold, at 390 px, without
   scrolling.
4. No screen shows a confidence score, token count, field name, rule id or the
   word "agent" — those live only under `/inspect`.
5. Every Needs-you item is a single question with at least one tappable answer.
6. A layperson who has never seen the app can, without help: find what's due,
   answer one question, and find a photo from 2021.

Criterion 6 is the real test. Hand the phone to someone and watch. If they ask
"what am I looking at?", the screen failed.
