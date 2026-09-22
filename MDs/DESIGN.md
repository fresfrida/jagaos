# DESIGN.md — JagaOS

A plain-text design system for AI agents building this product. Drop this in
the repo root. Any agent asked to build a screen reads this first and follows
it exactly. Where this and a screenshot disagree, **this file wins**.

Companion: UI-SPEC.md (what each screen does), this file (how it looks).

---

## 1. Visual theme & atmosphere

**Calm custodian.** This is a records keeper for someone who is anxious about
paperwork and opens the app about eight times a year. The resting emotional
state is *reassurance*, not urgency — she is on track almost always, and the
interface should feel like that is the normal condition.

Warm off-white ground, never clinical white. Generous space. Large, plain
type. Nothing dense, nothing clever. The product should feel like a good
paper filing system that happens to be awake.

**Two voices, deliberately split:**
- The **warm half** — her business's own story, the status line. Slightly
  editorial.
- The **plain half** — dates, amounts, filings, buttons. Utterly neutral.

Never let the warm voice carry data. Never let the plain voice carry feeling.

**Explicitly not:** dashboards, dark "AI" aesthetics, glows, gradients on
surfaces, glassmorphism, purple-to-blue, neon accents, dense data grids,
icon-only controls.

---

## 2. Colour palette & roles

```css
:root{
  /* ground & structure */
  --bg:#f7f4f0;          /* page — warm off-white, never #fff */
  --surface:#ffffff;     /* cards */
  --surface-2:#f0ebe4;   /* inset, sheets, wells */
  --line:#e7e0d7;        /* borders */
  --line-soft:#f0ebe4;   /* row dividers */

  /* text */
  --text:#1d1b18;        /* primary */
  --muted:#6d665d;       /* secondary */
  --faint:#9b938a;       /* tertiary, timestamps, placeholders */

  /* semantic — NOT the accent, never decorative */
  --ok:#2f6f4e;   --ok-bg:#e7f0ea;    /* on track, confirm, primary action */
  --warn:#96600f; --warn-bg:#fbf0dd;  /* needs you, due soon */
  --bad:#a5312a;  --bad-bg:#f9e8e6;   /* overdue, missing */

  /* categories — quiet, they are labels not the point */
  --c-filing:#5b6b9e;    /* statutory filings */
  --c-bill:#3f7a76;      /* bills & receipts */
  --c-doc:#8a7448;       /* important documents */
  --c-photo:#94627f;     /* photos & memories */
}
```

**Dark mode** redefines the same tokens — never define a colour only inside a
media query:

```css
--bg:#15140f; --surface:#232219; --surface-2:#2b2a22;
--line:#37352c; --text:#f0ece4; --muted:#a8a096; --faint:#7d766c;
--ok:#6fbb8f; --warn:#dda65a; --bad:#e8837a;
--c-filing:#94a5dd; --c-bill:#6cb3ae; --c-doc:#c5aa72; --c-photo:#c894b1;
```

### Colour rules

1. **`--ok` green is the resting state.** She is on track almost always, so
   green is the most common colour in the app. That is intentional.
2. **Red appears in exactly two situations: overdue, and missing.** Nowhere
   else, ever. If red starts appearing for emphasis it stops meaning anything,
   and "missing" is the most important signal in the product.
3. **Never signal state by colour alone.** Word + mark + colour, always
   (WCAG 1.4.1).
4. Category colours recede. They tint a 34px tile and nothing else. They never
   fill a card or a background.

---

## 3. Typography

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,600&display=swap">
```

```css
--ui:"Figtree",-apple-system,"Segoe UI",Roboto,sans-serif;
--ed:"Fraunces",Georgia,"Times New Roman",serif;
```

| Role | Face | Size | Weight | Notes |
|---|---|---|---|---|
| Status headline | Fraunces | 26px | 600 | the one warm moment on Home |
| Section heading | Fraunces | 20–24px | 600 | month names, screen titles |
| **All numerals** | **Figtree** | — | **700** | **see rule below** |
| Card title | Figtree | 18px | 600 | |
| Body | Figtree | 16px | 400 | never below 16px |
| Secondary | Figtree | 14.5px | 400 | `--muted` |
| Timestamp / meta | Figtree | 13.5px | 400 | `--faint` |
| Eyebrow label | Figtree | 11.5px | 600 | uppercase, `.09em` tracking |

### The numeral rule — non-negotiable

**Never set numerals in Fraunces.** Its optical-size axis makes digits
delicate and low-contrast at display sizes, and years, amounts and dates are
the most safety-critical text in this product. A year heading she has to
squint at is a defect, not a style.

```css
.year-heading{
  font-family:var(--ui);
  font-weight:700;
  font-size:30px;
  letter-spacing:-.02em;
  font-variant-numeric:tabular-nums;
}
```

Apply `font-variant-numeric: tabular-nums` to **every** figure: years, dates,
amounts, counts, countdowns. Anywhere digits stack, they must align.

Fraunces is for *words with feeling*: "You're on track", "The first year".
Nothing else.

---

## 4. Components

**Card** — `--surface`, 1px `--line`, radius 14px, padding 14px 16px.
No shadow. A left border 3px in a semantic colour is the only permitted
emphasis, used sparingly.

**Primary button** — full width, min-height 52px, `--ok` fill, white text,
radius 14px, 17px/600. One per screen, at the bottom, in the thumb arc.

**Secondary button** — transparent, 1px `--line`, `--muted` text, min-height 48px.

**Choice button** (answering a question) — full width, min-height 58px,
18px/600, centred. Hover/focus shifts border and text to `--ok`.

**Row** — `34px | 1fr | auto` grid: tile, name + attribution, date.
Divider `--line-soft`. Min-height 44px.

**Tile** — 34×34, radius 9px, category fill, white glyph.
`▤ filing · $ bill · ▢ document · ◈ photo · ⬚ missing`

**Missing row** — 1.5px **dashed** `--bad`, transparent fill. Dashed is the
signature of absence; never use dashes for anything else.

**Toast** — absolute, 12px inset, above the nav, `--text` fill, `--bg` text,
radius 12px, 6s. Carries an Undo affordance. Never blocks.

**Sheet** — bottom, radius 20px top, grab handle, options as
`44px | 1fr` rows min-height 60px.

**Bottom nav** — three targets maximum, labelled in **words**. Centre target
is the raised capture button, labelled **Add**. Icon-only controls are banned:
eight visits a year builds no muscle memory.

---

## 5. Layout

Spacing scale: **4 · 8 · 10 · 12 · 14 · 16 · 22 · 32**. Nothing else.

- Design at **390px** first. Let it breathe upward; never shrink a desktop.
- One column at every width below 900px. No side-by-side panes.
- Side gutter ≥16px at all widths, set once on one wrapper.
- Tap targets ≥44×44 with ≥8px between.
- Primary actions at the **bottom**. Never a primary action in the top bar.
- No tables, no horizontal scroll, anywhere in the owner-facing app.
- `height:100dvh` for the app shell on phones.

---

## 6. Depth & elevation

Almost flat. Three levels only:

1. **Page** — `--bg`, no border
2. **Card / row** — `--surface` + 1px `--line`, no shadow
3. **Floating** (sheet, toast) — the only shadows in the product

```css
--shadow-float: 0 -12px 40px -22px rgba(0,0,0,.45);
```

Border, fill, radius and shadow each say "separate object". Spend them by
role. Do not stamp one radius and one shadow on every block.

---

## 7. Guardrails

**Do**
- State the answer before the interface: the status is the first thing read
- Write questions a layperson can answer without looking anything up
- Show legal name, then the plain-English line beneath it
- Attribute every item — "added by a colleague"
- Offer Undo rather than a confirm dialog
- Cite the source of every machine claim

**Don't**
- Show a confidence score, token count, field name, rule id, or the word
  "agent" in the owner-facing app — those live only under `/inspect`
- Use jargon: *obligation, expectation, lane, extraction, trace, queue*
- Put more than one question on a screen
- Use red for emphasis
- Use an icon without a word
- Render body text below 16px
- Set numerals in Fraunces

### Vocabulary

| Never | Always |
|---|---|
| obligation | what's due |
| expectation / gap | missing |
| review queue | needs you |
| confidence below threshold | I'm not sure I read this right |
| quarantined | this looks off — I didn't file it |
| provenance / citation | where I got this |
| trace / tokens / agent | *(not shown)* |

---

## 8. Responsive

| Width | Behaviour |
|---|---|
| ≤430px | app fills the viewport, chrome dissolves, nav fixed at bottom |
| ≤640px | single column, phone frame removed, meta collapsed |
| ≥900px | app centred at 390px; inspection surfaces may use wider layouts |

`prefers-reduced-motion` disables every transition. 200% text zoom must not
clip or introduce horizontal scroll.

---

## 9. Scale — design for 2,000 items a year

An active SME adds roughly six items a day: ~2,200 a year, ~11,000 by year
five. Every list must be designed at that volume, not at demo volume.

- **Never one mark per item.** Year rows use a twelve-month bar strip with a
  total count, not dots.
- **Photos are shown as clusters**, never as raw lists. A cluster is a burst
  of photos sharing a day and a place: *"Foundation dug · 14 photos"* is one
  row that opens into a grid.
- **Counts are always visible** and always tabular-nums.
- Missing items stay prominent because they are rare — a handful against
  thousands. That contrast is the design, so never bury them behind a filter.

---

## 10. Agent prompt reference

```
Ground #f7f4f0 · Surface #ffffff · Line #e7e0d7
Text #1d1b18 · Muted #6d665d · Faint #9b938a
OK #2f6f4e · Warn #96600f · Bad #a5312a
Filing #5b6b9e · Bill #3f7a76 · Doc #8a7448 · Photo #94627f

Figtree for everything functional and ALL numerals (700, tabular-nums).
Fraunces 600 for the status line and month headings only — never digits.
Radius 14. Spacing 4/8/12/16/22/32. Body 16px minimum. Targets 44px.
One column. Primary action bottom. Three nav items, labelled in words.
Red only for overdue and missing. Dashed borders only for missing.
```
