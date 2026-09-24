# Handoff

Last updated: 2026-09-23. Read this first when resuming.

**Priority as of 2026-09-22 (DECISIONS #28): the product is testing agents
IN the app.** Backend pipeline work (classify/extract/verify/etc.) and
deploy plumbing (Vercel auto-deploy) are both treated as done for now. What
matters next is the logged-in, role-based app surface — see "Backend
status" and "How to resume" below.

## What this is

**JagaOS** — company memory for SMEs: capture documents, conversations, invoices and decisions, then retrieve them with natural-language search and cited sources.

This repo currently holds:
- **Planning docs** at root, moved into `MDs/` by the user 2026-09-22 (`ARCHITECTURE.md`, `PLATFORM.md`, `UI-SPEC.md`, `GAPS.md`, ...). Written for the earlier "JagaOS = Singapore corp-sec records keeper" concept. Useful context, not automatically current. `GAPS.md` §5 is still binding.
- **`web/`** — `/` (minimal signed-out landing, `WelcomeHero.tsx`, since 2026-09-23 DECISIONS #64 — redirects a signed-in visitor into the app instead of showing marketing content), `/login`, then six URL-addressable app pages (`/upload`, `/company-files`, `/search`, `/company-settings` — owner/admin-only, new 2026-09-23 — plus `/calendar` and `/tags` which double as the signed-in Calendar hub and Tags landing page once authenticated — DECISIONS #59, supersedes the old single tabbed `/ops` page, kept only as a redirect to `/upload`). Session-backed throughout, now role-aware end to end (DECISIONS #64, `docs/PERMISSIONS.md`). See "Where the main logic lives" below.
- **`app/`** — backend, per `ARCHITECTURE.md` §9 plus a 4-role auth layer (`app/auth.py`, 2026-09-22, DECISIONS #29-31; ownership + company-settings enforcement added 2026-09-23, DECISIONS #64). See "Backend status" below.
- **`evals/`** — eval runner + adversarial cases, `evals/report.md` committed (10/10 passing, no gateway key needed).
- **`tests/`** — pytest: deterministic core, live-gateway, review pause/resume, auth/tenant-isolation/ownership, company settings, and vision-caption async wiring (`tests/test_vision_caption.py`, mocked, no torch). 41/41 passing (most need no gateway key).
- **`deploy/`** — Lightsail provisioning (Caddy, systemd, `bootstrap.sh`, plus `jaga-vision.service`, DECISIONS #55). **`jaga-vision` is now deployed and confirmed working on production** (2026-09-23, DECISIONS #56 — a real uploaded photo got a correct caption, checked directly in the live DB); `MemoryMax` enforcement and the exact dependency versions running on the box are still unconfirmed, see "Known gaps" below.
- **`vision/`** — isolated image-captioning service (own venv, `Salesforce/blip-image-captioning-base`), 2026-09-23, DECISIONS #55. Deliberately separate from `app/` — see "Backend status" below.
- **Python env** — conda env `agent` (Python 3.11.16), `requirements.txt` installed.
- **`DB/`** — schema screenshots (source of truth for tables; no SQL file exists). `app/db.py` implements the SQLite translation per `ARCHITECTURE.md` §2.
- **GitHub**: `github.com/fresfrida/jagaos` (private). **Collaboration mode is `solo` as of 2026-09-22** (project `CLAUDE.md`'s first line) — commit and push freely after each completed task, no explicit ask needed; `./scripts/prepush-check.sh` still runs before every push. Redeploying the Lightsail backend (not git-triggered) still needs an explicit ask either way — **a standing rule that holds even when a round's own instructions say otherwise, since only the user's own ask satisfies it, not a relayed one** (DECISIONS #69 was explicitly authorized to push without a separate go-ahead, unlike #65-#68, but Lightsail still wasn't redeployed for it). **DECISIONS #65 through #69 have all been committed and pushed** (`249ee8c`, `73a49ef`, `7a76863`, `3fa2d18` — confirmed via `git log`) — nothing is sitting uncommitted as of DECISIONS #69. **Lightsail itself is now behind `main`** — see "Known gaps" below for what it's missing.

## Backend status (2026-09-21)

The core loop from `ARCHITECTURE.md` §3 is wired end to end: `ingest` (hash,
dedupe, pdfplumber/OCR/EXIF, no LLM) → `classify` (haiku) → `extract`
(sonnet4.5) → `verify` (deterministic: GST arithmetic, confidence floor,
injection scan) → `human_review` (LangGraph `interrupt()`) → `derive_events`
(sonnet4.5) → `derive_expectations` (deterministic gap analysis) →
`derive_obligations` (deterministic statutory clock) → `archive`. FastAPI
exposes it at `/api/documents` (upload), `/api/review/*` (resolve),
`/api/expectations`, `/api/obligations`, `/api/trace/{document_id}`.

**Verified without a gateway key** (`pytest tests/test_rules_smoke.py`,
`python evals/run.py`): DB schema creates all ten tables; the Annual Return
rule computes FYE + 7 months correctly; the injection guardrail catches the
five adversarial phrasings in `evals/cases/adversarial/injection.yaml`
(10/10, including one gap the eval suite itself found and that got fixed —
`app/guards/injection.py`'s regex list); GST arithmetic mismatches are
flagged; the `satisfied → open` obligation transition is correctly rejected
(authority separation, §5.2).

**Verified live against the real gateway** (2026-09-21, `tests/test_gateway_live.py`,
`.env` filled from the kickoff screenshots): classify → extract → verify
runs end to end on a synthetic invoice — correct lane, all 7 fields
extracted with citations and confidence, GST arithmetic checked, no false
review flag. **Two real bugs found and fixed in the process — see `GAPS.md`
§11**: (a) only the `sonnet4.5` model is approved for this team's key,
`haiku`/`sonnet` are rejected, so the cheap-routing design has no cost
saving to claim; (b) tool calls need an explicit `max_tokens` (now 2048 in
`app/llm.py`) or the gateway silently truncates a multi-field extraction —
this looked exactly like a schema bug and cost real debugging time.

**`derive_events` also verified live** (2026-09-21): a synthetic ACRA
notice of registered-office change correctly produced one `office_move`
event with the right date. All three LLM nodes in the pipeline
(classify/extract/derive_events) are now confirmed working against the
real gateway.

**Full pipeline run through the real FastAPI app** (2026-09-21,
`evals/demo_corpus/`): 8 synthetic documents for a fictional SME, "Bright
Harbour Pte Ltd" — used instead of the team's real documents (privacy;
see `WINNING.md`'s "clearly-labelled active-SME corpus"). Uploaded through
`/api/documents` via `TestClient`, not called as bare functions. Results
in `evals/demo_corpus/RESULTS.md`, regenerate with
`python evals/demo_corpus/run.py`. `pytest tests/` is 9/9.

This run found and fixed three more real bugs, on top of the two in
`GAPS.md` §11:
1. **`main.py` never detected a paused review.** `langgraph==0.2.60`'s
   `PIPELINE.invoke()` does not return a `"__interrupt__"` key the way the
   original code assumed — it just stops early with a partial state (the
   pause itself is real: `derive_events`/obligations correctly never ran).
   Fixed by reading `document.status` from the DB instead, which
   `verify.py` sets unconditionally.
2. **Gap analysis never matched a document to its expectation.**
   `classify`'s `doc_type` is free text ("ACRA Certificate of
   Incorporation"); `expectation.doc_type` is a fixed slug
   (`certificate_of_incorporation`). Exact-match never matched, so every
   expectation showed "missing" even when the document was right there.
   Fixed with normalized-slug substring matching in
   `app/graph/derive_expectations.py` — real but not complete; a
   differently-worded doc_type could still miss. Semantic matching is the
   proper long-term fix.
3. **A gap that closed later never got re-checked.** Expectation status
   was set once, at creation time, against whatever documents existed
   *then*. The constitution document, uploaded after the incorporation
   event (from a different document) had already created a "missing"
   Company Constitution row, stayed "missing" forever. Fixed with a
   reconciliation pass that re-checks open gaps against currently-held
   documents on every ingest.

**Verified real result on the demo corpus**: 2 of 6 expected documents
held (gap analysis correct), one GST-mismatch invoice correctly routed to
human review (not silently accepted), one injection-attempt invoice
correctly quarantined **inside the real product flow** — not just the
isolated eval case — with the obligation table untouched, 2 statutory
obligations derived with citations, total LLM cost $0.125 across 8
documents (≈1.6¢/document, placeholder pricing).

**False-positive hard quarantine found live on Lightsail, fixed 2026-09-22**
(DECISIONS #33): a genuine invoice (Lay Meng Engineering Technology Pte Ltd,
document id 9, uploaded through `/ops` on the live Lightsail backend) was
hard-quarantined with `security_event` showing `regex=[]`, `model_flag=True`
— the model's own self-reported `injection_suspected` flag fired alone, with
no regex corroboration, on ordinary warranty/exchange-policy boilerplate
("must be unused", "will not apply if..."). This directly contradicted
`verify.py`'s own module docstring, which already claimed the model's
self-report is never trusted alone — the docstring was right, the code (a
single `or` across the regex hit and both models' self-flags) had drifted
from it. Fixed: a regex hit is still an unconditional hard quarantine
(deterministic, independent signal, unchanged); a model-only flag now routes
through the same `needs_review` path as the GST/low-confidence checks below
it in the same file, with a review question asking a human to confirm the
document is safe. `app/rules/transitions.py`'s `"quarantined": set()` (no
legal next state) is deliberately left as-is — a genuine regex-corroborated
quarantine staying a dead end is a separate, defensible choice, not this
bug. New tests in `tests/test_rules_smoke.py`; full suite 23/23.
**Document id 9 itself, stuck on the live Lightsail DB from before this fix,
is not touched by it** — a manual DB fix, handled separately by the user,
not scripted here. Also noticed in passing, backlogged, not fixed: `app/
guards/injection.py::quarantine()` writes document status via raw SQL
rather than through `transitions.py`'s authority-separated
`transition_document()`.

**Review queue now shows the source document; uploads are normalized
client-side (2026-09-22, DECISIONS #34).** Found live the same day as the
quarantine bug above, investigating a different real invoice photo whose
extracted vendor/GST/year were all wrong (bad OCR on a skewed, high-res
phone photo — `app/extract/ocr.py` does zero preprocessing, unchanged by
this fix): the reviewer had no way to notice, because the review card never
showed the source. Confirming fields you can't check against the source
isn't a safety check. Fixed on both ends: `GET
/api/documents/{id}/file` (session-gated, tenant-checked, streams the
original bytes inline) plus a blob-URL fetch in the frontend (`<img>` can't
carry the session's bearer token, so `opsApi.fetchDocumentFile` fetches
authenticated and points the preview at a local `blob:` URL) show the
source photo/PDF next to the fields in each review card, and a "source →"
link on the documents table opens any document the same way. Separately,
`web/src/lib/imageNormalize.ts` downscales an uploaded image to ≤2000px on
its longest side and re-encodes as JPEG *before* `opsApi.uploadDocument` —
verified live end to end: a 3024×4032 EXIF-rotated test photo (209,931
bytes) reached the server as an upright 2000×1500 JPEG (24,087 bytes,
≈11.5% of the original). **Orientation correction is deliberately not
hand-rolled** — `createImageBitmap()` already applies EXIF-orientation
correction by default in every shipping browser; a first version that read
the EXIF tag manually and re-applied it on top of that double-rotated the
image, caught via a live Chrome test before shipping (DECISIONS #34 has the
full story and why not to re-add it). New test:
`tests/test_auth.py::test_document_file_endpoint_serves_own_company_and_404s_for_other_company`;
full suite 24/24. No automated test for the client-side normalization
itself — explicitly out of scope (depends on real EXIF/canvas behavior),
verified live instead: `docs/screenshots/ops-review-card-source-preview.png`,
`ops-after-normalized-upload.png`. Deskewing/cropping a skewed photo (the
actual OCR-quality fix) is a separate, bigger, still-open task —
`docs/KANBAN.md` backlog.

**OCR page-segmentation mode fixed (2026-09-22, DECISIONS #35).**
`app/extract/ocr.py` now calls `pytesseract.image_to_string(image,
config="--psm 6")` instead of Tesseract's default PSM 3 ("fully
automatic"), which the user had already confirmed live drops a
right-aligned numeric table column on a real invoice (labels like "Sub
Total" came through, their values didn't). One-line change, already
diagnosed and tested before this session touched it. **`evals/demo_corpus/`
turned out not to be a real test bed for this**: all 8 files are PDFs with
genuine `pdfplumber`-extractable text layers (`has_extractable_text()` is
`True` for all of them), so `ingest.py` never routes them through OCR at
all — checked, not assumed. Verified instead with two synthetic images
(invoice-style labels + right-aligned numbers; plain prose) — `pytesseract`
output is identical under default PSM and `--psm 6` on both, no regression.
No new automated test (not requested; OCR needs real image input the
gateway-free suite doesn't have).

**Document archive + expired-review escape hatch, Documents tab mobile
fixes, confidence-copy fix (2026-09-22, DECISIONS #37-39).** Three related
fixes from live user testing on the deployed app. (1) New `POST
/api/documents/{id}/archive` (admin+) — soft-delete only, the row/file/full
audit trail all stay intact, matching this product's own "don't lose
evidence" pitch; `app/rules/transitions.py` now lets every document status
reach `"archived"` (no restore path). This doubles as the fix for (2):
`resolve_review`'s 410 (an expired review session — the `MemorySaver`
checkpoint below is gone) was previously a dead end showing the user a raw
internals string with Accept/Reject both just failing again; `ReviewQueueCard`
now catches that 410 specifically and offers Archive plus a re-upload hint
instead. (3) The Documents tab was a plain `<table>`, illegible on a phone
(filename/doc_type cut off, no status badge) with what looked like no way
to view the actual file — that last part turned out to already exist
(a `window.open()`-based button, added at DECISIONS #34) but was almost
certainly silently popup-blocked on mobile (it opened the window *after*
an `await`, which most mobile browsers block unless synchronous with the
click) — fixed at the root (open a blank tab synchronously, navigate it
once the blob resolves) rather than re-added blind. Table replaced with
cards (matching `ReviewQueueCard`'s existing pattern) plus a status badge,
View/Trace/Archive per row, and a client-side "Show archived (N)" toggle
(no new query param). (4) The upload-result banner's confidence label now
reads "classified as {lane}/{doc_type} (N% confident)" — the old "confidence
0.95" next to "PROCESSED" read like a blanket trust score on the extracted
fields; it's actually just document-type classification confidence.
New test: `tests/test_auth.py` (archive, own-company + tenant-isolation
404). Full suite 25/25, typecheck + build clean. Verified live (Playwright,
390px viewport, the real expired-checkpoint condition — a `review_item`
with a `thread_id` never run through the pipeline, not mocked): no raw
internals text reaches the page, Archive clears the Needs Review queue,
long filenames wrap instead of clipping, the archived toggle works, View
opens a real tab with a genuine `blob:` URL. Screenshots:
`docs/screenshots/ops-review-expired-archive.png`, `ops-documents-mobile.png`,
`ops-documents-mobile-show-archived.png`.

**No document auto-files anymore, even a clean one (2026-09-22, DECISIONS
#40).** Explicit product decision, not a bug fix: `verify.py`'s "auto-file
when clean" path is gone — `needs_review` is unconditional except the hard
regex-corroborated injection quarantine. A clean document gets a distinct,
honest review question ("No issues found. Please confirm the extracted
fields below are correct before filing.") instead of an empty "Please
confirm: ". The review card styles a routine confirm differently from an
actual flag (muted vs. amber-800 question text) so every single upload
doesn't read as something went wrong — the form is pre-populated either
way, so confirming a clean document is one tap. `app/main.py`'s now-dead
"processed" (auto-filed) response branch was removed, not left stubbed;
`opsApi.ts`'s `UploadResult.status` type dropped `'processed'` to match.
**`evals/demo_corpus/RESULTS.md` is now stale**: 6 of its 8 documents show
`status: processed`, which the pipeline can no longer produce — not
regenerated here (real gateway cost, separate concern), tracked in
`docs/KANBAN.md`. `pipeline.py` and `human_review.py` needed no changes —
both already keyed purely off `verify_result.needs_review`, confirmed by
re-reading fresh rather than assumed. New tests + a live-gateway assertion
flip in `tests/test_gateway_live.py`; full suite 27/27 at the time.

**Real full-text search and tags (2026-09-22, DECISIONS #41).** Schema:
`document.description`, `tag`/`document_tag` tables, and a standalone FTS5
virtual table `document_search` (`app/db.py`) — filename/doc_type/
description/extracted_text/denormalized tag names, `company_id` UNINDEXED
for tenant-scoped queries, `rowid = document.id`. Kept in sync via
`reindex_document_search()` (delete + re-insert) from `ingest.py` (once
extracted_text is first set), `classify.py` (once description/tags are
set), and the new edit endpoint. `app/graph/classify.py` — not
`extract.py`, which only runs for invoice/statutory lanes — now asks the
LLM for a one-sentence description and 2-4 lowercase tags for every
document, written directly (organizational metadata, not a compliance
decision). Three endpoints: `GET /api/search` (FTS5, tenant-scoped, safe
query building), `GET /api/tags` (with document counts), `PATCH
/api/documents/{id}` (user+, tags REPLACE the set). **Deliberately did NOT
touch `web/src/features/search/`, `features/tags/`, or `features/memories/`**
— confirmed by reading `Page.tsx`'s routing, not assumed: those serve the
logged-out marketing preview ("This preview searches sample data" is their
own copy), which has no session to call an authenticated endpoint with.
The real search/tags UI is new surface inside `/ops` instead
(`opsApi.search`/`listTags`/`editDocument`), reusing the review card and a
new `DocumentCard` component (Documents tab: search box, tag-filter chips,
inline description/tag editing). New tests in `tests/test_auth.py`
(tenant isolation, PATCH persistence, tag normalization). Full suite
28/28. Verified live end to end with one real gateway upload — the real
LLM produced description "Invoice from Zylotech Consulting Pte Ltd for
cloud infrastructure consulting, SGD 436.00" and tags "cloud
infrastructure, consulting, invoice, zylotech", both editable in the
review card, saved on Accept, then findable via real search and a
tag-filter chip. Screenshots: `docs/screenshots/ops-review-real-classify-fields.png`,
`ops-documents-real-doc-edited.png`, `ops-review-flagged-styling.png`,
`ops-search-results.png`, `ops-documents-tag-filter-and-edit.png`.

**Metadata rework, preview UX, and a Dates tab (2026-09-22, DECISIONS
#42-44) — supersedes #41's *tag* portion only, #40's always-review rule is
unchanged.** `document.bucket` (fixed 6-value taxonomy: Receivables /
Expenses / Statutory / Operations / "Memory Lane" / Miscellaneous) and
`document.vendor_name` replace the `tag`/`document_tag` tables —
`classify.py` sets bucket per lane (invoice lane defaults to Expenses,
*provisionally*: classify runs before extraction, so it doesn't yet know
the vendor); `extract.py` deterministically flips it to Receivables once
the extracted vendor slug-matches the company's own name
(`_is_this_company`, reusing `derive_expectations.py::_slug`'s exact
normalization). `doc_type` is now a tightened, fixed vocabulary for the
invoice/important/memory lanes (invoice/receipt/PO/quotation/
delivery_order/contract/photo/other) — the statutory lane's free-text
`doc_type` is untouched. Also fixed in the same prompt pass: the model no
longer comments on OCR quality/data completeness inside description/
bucket/doc_type/vendor_name (confirmed live pre-fix: a real description
read "Studio invoice with incomplete or corrupted text data" — the model
describing its own extraction, not the document); every rendered
confidence changed from `(0.30)` to `(confidence: 30%)`; `PATCH
/api/documents/{id}` gained `filename` (display-only) and `doc_type`
(missing from the first pass at this endpoint, caught before shipping).
`GET /api/tags` removed — bucket is a fixed frontend constant
(`opsApi.BUCKETS`), no API call needed. **Found and fixed a real gap**:
`document.occurred_on` existed as a column but, confirmed by grep across
`app/`, was previously populated *only* from EXIF photo metadata —
`extract.py` now also writes it from the extracted `issued_on` date for
the invoice and statutory lanes. Frontend: Documents tab gets a
bucket-chip filter (replacing tag chips), a small thumbnail per row (real
image, or a generic PDF icon — no first-page rendering), and an in-page
`DocumentViewerModal` that replaces the old "View" action's
`window.open()` (a dead end on mobile — that popup-blocker workaround,
DECISIONS #38, is now dead code and was removed, confirmed via grep for
its only call site first). A new **Dates** tab groups documents by
**"Upload date"** or **"Document date"** (exact labels), with an explicit
**"No document date"** section rather than silently hiding undated
documents. Schema migration needed a real drop+recreate+backfill for
`document_search`'s FTS5 columns (`tag_names` → `bucket`/`vendor_name`) —
`CREATE VIRTUAL TABLE IF NOT EXISTS` is a no-op against an existing table
in the old shape; the 40 pre-existing documents were manually
re-indexed afterward (their `bucket`/`vendor_name` stay null — additive
migrations don't retroactively reclassify old rows; the UI treats null as
"no bucket," verified live, not a crash). New/updated tests across
`tests/test_rules_smoke.py` (empty-text → `bucket="Memory Lane"`, no
gateway call; `_is_this_company` unit tests), `tests/test_gateway_live.py`
(bucket/occurred_on assertions on the existing invoice test; a new
self-issued-invoice test confirming the Receivables flip against the real
gateway), `tests/test_auth.py` (tag-based tenant-isolation test rewritten
for bucket/vendor_name/filename, plus a PATCH cross-tenant 404 check).
Full suite 31/31, typecheck + build clean. Verified live end to end
(Playwright): a real gateway upload of a self-issued invoice showed a
natural description with no OCR-quality commentary, `bucket` correctly
read **Receivables**, every field showed `(confidence: 100%)`, and the
bucket-chip counts updated to match; thumbnails render real images/generic
PDF icons; the view modal opens in-page with zero new tabs; the Dates tab
correctly grouped one EXIF-dated photo under its own day and labeled the
other eight **"No document date (8)"** rather than hiding them. Screenshots:
`docs/screenshots/ops-review-confidence-and-bucket-fields.png`,
`ops-documents-thumbnails-and-buckets.png`,
`ops-document-card-edit-fields.png`, `ops-view-modal.png`,
`ops-dates-upload-date.png`, `ops-dates-document-date.png`,
`ops-live-upload-receivables-detected.png`.

**`doc_type` dropdown + `vendor_name` autocomplete (2026-09-22, DECISIONS
#45) — amendment to the metadata rework above.** Rule: category fields are
dropdowns, name fields are free text with autocomplete. `doc_type` is now
a `<select>` hard-locked to `DOC_TYPES` (mirrors `classify.py`'s prompt
vocabulary) for every lane except statutory, which keeps the free-text
input it already had (its doc_type is a name, not a category — forcing it
into a dropdown would break `derive_expectations.py`'s slug matching). A
value outside `DOC_TYPES` gets a synthesized "(legacy)" option rather than
vanishing. `vendor_name` stays free text with a shared `<datalist>`
autocomplete sourced from this company's existing vendor names (no new
endpoint). `bucket`'s server-side rejection was re-verified live (422 on
an invalid value), not assumed. Typecheck/build clean, suite still 31/31.
Screenshots: `docs/screenshots/ops-doctype-dropdown-invoice-lane.png`,
`ops-doctype-freetext-statutory-lane.png`, `ops-vendor-autocomplete.png`.

**Upload-result banner no longer badges a routine upload (2026-09-22,
DECISIONS #47).** Same `reason === 'clean extraction'` distinction
`ReviewQueueCard` already makes (DECISIONS #40) — `POST /api/documents`
gained `review.reason`, the banner skips `StatusPill` when the upload was
clean, every other outcome (flagged, quarantined, duplicate) keeps it.
Verified live, both states. Screenshots:
`docs/screenshots/ops-banner-routine-no-badge.png`,
`ops-banner-flagged-with-badge.png`.

**Hallucination guard: extracted invoice amounts must appear in the source
text (2026-09-22, DECISIONS #48).** Confirmed live on Lightsail (document
id 14): the model can fabricate internally self-consistent
subtotal/gst/total — passes `_check_invoice_arithmetic` and the confidence
floor both — while being entirely wrong (extracted 440/39.6/479.6 against
real printed values of 110.00/0.00/110.00; `440 × 1.09 = 479.6`, so the
arithmetic looked fine). New `verify.py::_check_amounts_in_text()` flags
when *none* of the three extracted values appear anywhere in the source
text, in any of a few plausible string formats — a new reason on the
existing `needs_review` path, nothing auto-rejected or downgraded.
Deliberately conservative (all three must be absent, not just one) and
scoped to subtotal/gst/total only — dates/names have too many legitimate
reformatting variations to text-match reliably the same way. **Known,
stated limitation**: this only catches "absent from the text entirely,"
not "present but still wrong" (e.g. a value that's genuinely printed
somewhere in the document but happens to be incorrect, or a fabricated
number that coincidentally matches a substring elsewhere) — a harder
problem, not solved here. New tests reproduce document id 14's shape and
confirm no false positive on a correct extraction (the Lay Meng
Engineering invoice's numbers, all present in its text). Full suite
33/33, including the existing live-gateway invoice test re-passing against
a real extraction (no false positive on genuine model output). No UI
change.

**Review card and Documents card decluttered (2026-09-22, DECISIONS #49).**
Filename used to render twice per card — the static header, and a
duplicate "Filename" input further down the metadata form. The header is
now directly editable in place (borderless until hover/focus, so it reads
as a title, not another form field) and the separate input is gone.
Fields are grouped under a "Document" heading (description/bucket/doc
type/vendor name) and, in `ReviewQueueCard` only, an "Extracted fields"
heading below a divider (the model's own extracted values, each with
confidence) — `DocumentCard` never showed extracted fields, so it only
gets the header change. Both cards' filename-editing *mechanism*
deliberately stayed different: `ReviewQueueCard` has no view/edit toggle
(everything's always live), so its title is always an input;
`DocumentCard` already has an `editing` toggle, so its title only becomes
an input inside that same toggle, like every other field there. No
information or editing capability removed. Verified live: focus shows a
clear border, a renamed filename actually saves via the relocated field,
zero duplicate "Filename" fields anywhere when no card is mid-edit.
Typecheck/build clean; no backend change, so the backend suite wasn't
re-run. Screenshots: `docs/screenshots/ops-review-card-decluttered.png`,
`ops-review-card-filename-title-focused.png`,
`ops-document-card-edit-decluttered.png`.

**A flagged review's warning is now repeated above Accept/Reject
(2026-09-23, DECISIONS #51).** `ReviewQueueCard`'s reason/warning text
(`item.question`, e.g. "GST 33.0 is not ~9% of subtotal 440.0...") only
ever rendered once, near the top of the card, above the source-document
preview and the Document/Extracted-fields groups — on a long card, a
reviewer scrolling down to Accept/Reject could lose the warning off-screen
and click without ever seeing why the document was flagged. This matters
more than a typical cosmetic gap: `verify.py`'s GST-arithmetic and
hallucination-guard checks (DECISIONS #33, #48) both deliberately still
route to human judgment instead of auto-rejecting, so that safety model
only holds if the warning is actually seen before the click. Fixed by
repeating the same text, same `text-amber-800` styling, immediately above
the Accept/Reject buttons — gated on the same `isRoutine` check the card
already used, so a routine "no issues found" confirm (nothing to repeat)
is untouched. No sticky/pinned header, just a second static copy.
Verified live (real login as `owner@try-demo.test`, a real already-seeded
flagged GST-mismatch item and a real routine item, not mocks); typecheck +
build clean; backend suite 33/33 (no backend change). Screenshot:
`docs/screenshots/ops-review-card-repeated-warning.png`.

**"Is this a picture?" upload toggle replaces guessing for the memory
lane; filename is no longer a card title anywhere (2026-09-23, DECISIONS
#52).** The gateway this hackathon provides is confirmed text-only
(`MDs/GAPS.md` §8, re-confirmed live this session) — it was never
possible for `classify.py`'s LLM call to actually look at a photo and
describe it, so guessing was replaced with asking. A prominent Yes/No
toggle above the upload dropzone ("Is this a picture, not a document?",
default No, a note appears only on Yes) is sent as `POST
/api/documents?is_picture=true`; `app/graph/classify.py` checks
`state["is_picture"]` first (before its existing empty-text fallback) and,
when true, skips the LLM call entirely — `lane='memory'`,
`doc_type='photo'`, `bucket='Memory Lane'` are set by fixed rule, and
`description` is left `NULL` (an explicit "pending caption" state, not a
guessed sentence) until a human supplies one. No `trace` row is written
for this path, the same convention `extract.py`'s lane-skip already uses
— which is also how a test proves no gateway call happened at all, not
just that the result looks right
(`tests/test_rules_smoke.py::test_classify_is_picture_toggle_skips_llm_and_sets_memory_lane_deterministically`).
The same correction is available after upload via
`DocumentEditRequest.is_picture` (PATCH `/api/documents/{id}`) — grouped
with the other document-level fields, one-directional (corrects *into*
memory lane, never back out; the checkbox locks once already set). A new
`useSpeechCaption` hook (`web/src/hooks/useSpeechCaption.ts`, Web Speech
API, no backend change, no new dependency) backs a mic button next to
Description on picture-lane documents only — tap, speak, the transcript
fills the same field a typed caption would. **Supersedes DECISIONS #49**:
filename is no longer shown as a card title in either `ReviewQueueCard` or
`DocumentCard` — it's a plain field in the same "Document" group as
description/bucket/doc_type/vendor_name. `ReviewQueueCard`'s header is now
just the flagged-reason/routine-confirm text; `DocumentCard`'s header now
shows `description` in filename's old spot (falling back to "No caption
yet" or `lane / doc_type`), and the old separate description-preview
paragraph beneath it was removed as a now-literal duplicate. Full suite
34/34, typecheck + build clean. Verified live end to end — real login,
a real synthetic photo uploaded through the real toggle, not mocked —
plus a regression screenshot confirming an existing non-picture flagged
card (filename field, no mic button, picture-toggle available but
unchecked) still works. Screenshots:
`docs/screenshots/ops-upload-picture-toggle-no.png`,
`ops-upload-picture-toggle-yes.png`, `ops-review-card-picture-lane.png`,
`ops-voice-caption-control.png`, `ops-document-card-picture-collapsed.png`,
`ops-document-card-picture-editing.png`,
`ops-review-card-filename-decluttered.png`.

**Archived documents are now actually inaccessible through the app, for
every role including owner — a real access-control fix, not a cosmetic
one (2026-09-23, DECISIONS #53).** `GET /api/documents` had no role floor
(`get_current_membership`, not `require_role`) and never excluded
`status = 'archived'` from its query — any authenticated member, viewer
included, could already see an archived document by calling the endpoint
directly; the Documents tab's "Show archived" checkbox (`OpsConsole.tsx`)
only hid the row visually, it never controlled access. `GET /api/search`
had the identical gap in its join back to `document` after the FTS5
match. Both now add `AND status != 'archived'` unconditionally — no
parameter, no role exception, no way to opt back in from either endpoint.
`POST /api/documents/{id}/archive` is unchanged (still admin+, still
`transition_document()`-routed) — archiving now genuinely means gone from
the app, for the admin/owner who archived it too. `showArchived`,
`archivedFiltered`, and the checkbox were removed entirely from
`OpsConsole.tsx`; two more now-dead defensive `status !== 'archived'`
checks (a per-row Archive-button visibility guard, the Dates tab's
document filter) were found and simplified while double-checking rather
than assumed clean — both were provably-always-true once the server-side
fix landed. `list_review_items` was checked too and found already correct
(`archive_document` dismisses any open `review_item`, so an archived
document was never reachable through the review queue). New test:
`tests/test_auth.py::test_archived_documents_never_appear_in_list_or_search_for_any_role`
(own-company data for owner and viewer, not just tenant isolation — a
positive-control live document confirms the exclusion is specific, not a
"returns nothing" bug). Full suite 35/35, typecheck + build clean.
Verified live (real archive of a real seeded `filed` document through the
real UI): the Documents tab shows no archived-related control anywhere,
the document count drops immediately, re-searching its exact filename
afterward returns nothing. **Found, not fixed here (added to
`docs/KANBAN.md` Backlog)**: `GET /api/documents/{id}/file` and `GET
/api/trace/{document_id}` still don't exclude archived documents when
fetched directly by a known ID — narrower than the fixed gap (needs prior
knowledge of the ID) but the same class of issue, out of this task's
stated scope. Screenshots:
`docs/screenshots/ops-documents-no-show-archived-control.png`,
`ops-documents-after-archive-fully-hidden.png`.

**DECISIONS #53's deferred piece closed: the file/trace endpoints now 404
an archived document too (2026-09-23, DECISIONS #54).** `GET
/api/documents/{id}/file` and `GET /api/trace/{document_id}` fetch by a
known document id directly, bypassing the listing endpoints #53 fixed —
so someone who already had an archived document's id (browser history, a
saved link, a network request captured before archiving) could still pull
its file bytes or full trace report. Both endpoints' lookup queries gained
`AND status != 'archived'`: `get_document_file`'s archived id now falls
through its existing `doc is None` branch to the same 404 a nonexistent
id gets, no new branch; `get_trace`'s got the identical change, landing on
404 rather than the 403 it deliberately uses for a genuine cross-tenant
document (a separate, pre-existing, still-accepted leak, unrelated to
this fix) — the point was full invisibility for a same-company archived
document, not "exists but denied." **Disclosed side effect, not a
regression**: because the exclusion lives in `get_trace`'s one lookup
query, an archived document in a *different* company now also reads as
404 instead of that pre-existing 403 leak — strictly more invisible, not
less. New test:
`tests/test_auth.py::test_archived_documents_404_from_file_and_trace_endpoints_even_in_own_company`
— asserts 404 from both endpoints for an archived document that has real
seeded trace rows (proving the exclusion happens before any data lookup,
not just "empty result coincidentally looks like 404"), with a
positive-control live document confirming both endpoints still work
normally. Full suite 36/36. No frontend change — the UI has had no path
to reach an archived document's id since #53's fix, so nothing there
needed touching or re-verifying.

**Local image captioning for picture-lane uploads — built and verified
locally end to end; not yet deployed (2026-09-23, DECISIONS #55).**
Closes the backlog gap DECISIONS #52 deliberately left open: a
picture-toggle upload's `description` stayed `NULL` ("pending caption")
until a human typed or spoke one. New top-level `vision/` (sibling to
`app/`, `web/`, `deploy/` — deliberately not inside `app/`): a plain
FastAPI service, one `POST /caption` endpoint (`{"path": "..."}` →
`{"caption": "..."}`), running `Salesforce/blip-image-captioning-base`
via `transformers`' `BlipProcessor`/`BlipForConditionalGeneration`, bound
to `127.0.0.1:8100` only (no auth needed — unreachable from outside the
box). Its own venv, own `requirements.txt` (CPU-only torch via
`--extra-index-url https://download.pytorch.org/whl/cpu`) — torch/
transformers never enter `app/`'s own dependency resolution, the whole
point of the isolation on a 4GB box. **The model loads fresh on every
request and is released after, never kept resident** — a deliberate
decision, not a missing optimization: peak RSS while loaded is ~2GB
(measured before this task), and captioning is async, so nothing is
waiting on the ~20s load time; keeping it warm would trade a real
stability risk for a latency saving nobody needs.

**Superseded 2026-09-23, DECISIONS #58**: the ~2GB figure above was a
macOS development measurement — the real number on the live Lightsail
box, under a real captioning call, is ~390MB RSS. At that footprint,
keeping the model resident is affordable and removes the ~20s
per-request load penalty, which turned out to be the actual source of a
real user's "captions feel slow" complaint. `vision/app.py` now loads
the model once at process startup instead of per-request — see the
DECISIONS #58 entry further down for the full change (not yet deployed
to the box as of this writing).

`app/main.py::upload_document` gained `background_tasks: BackgroundTasks`
and, only for `is_picture=True` uploads, schedules a fire-and-forget
`_caption_document_background(document_id, absolute_path)` call after the
pipeline runs, before the response returns. **Timed live with the real
vision service running: 0.115-0.135s response time**, confirming the
upload response genuinely does not wait on the ~4-20s caption call. On
success: `UPDATE document SET description = ? WHERE id = ? AND
description IS NULL` — verified live, not just written, that a human
edit racing ahead of the slower background result wins, never gets
clobbered. On failure/timeout (`httpx`, 40s budget, bare `except
Exception`): description simply stays in its existing pending state —
the DECISIONS #52 voice-caption UI already covers that, so no new error
surface was added.

**A real bug was found and fixed during local verification, not assumed
away**: the first live end-to-end test produced a genuine `400 Bad
Request` from jaga-vision — `document.stored_path` is a relative path
(`app/graph/ingest.py`'s `DOCS_PATH`), meaningless to a second process
with its own working directory (it resolved against `vision/`'s cwd, not
the repo root, so the file "didn't exist"). Fixed by resolving to an
absolute path in `app/main.py` — the process that actually knows its own
correct base directory — before the background task ever calls out.
Re-verified afterward: a real caption ("a blue circle with a white
center," for a synthetic test image) landed in `document.description`
within seconds and was findable via real `GET /api/search`.

New tests, gateway-free and torch-free (the real vision call is mocked at
the `httpx.post` boundary): `tests/test_vision_caption.py` — upload
response succeeds even when the mocked call raises (proving no
dependency on it), a successful mock fills the pending description, a
non-picture upload never calls the vision service. Full backend suite
39/39.

**Explicitly NOT deployed, and three specific things are unverified until
it is** (`docs/KANBAN.md` Backlog has the details): (1) `MemoryMax=2.5G`
on `deploy/jaga-vision.service` — the safety mechanism the whole isolated-
service design depends on — could not be exercised at all locally (no
systemd/cgroups on macOS); `deploy/README.md` has an exact live-box
verification procedure. (2) The pinned `torch==2.9.1`/
`transformers==4.47.1` were only installed/verified on macOS + Python
3.13, not the box's actual Ubuntu 24.04 + Python 3.12. (3) The deploy
steps documented in `deploy/README.md` (venv creation, model
pre-download, systemd enable) have never been run end to end against the
real box. No screenshots — no UI change; the existing DECISIONS #52
review-card UI already renders both the pending and captioned states with
zero new frontend code.

**`jaga-vision` is now deployed and confirmed generating correct captions
on production — which surfaced a real frontend bug, now fixed (2026-09-23,
DECISIONS #56).** Confirmed live, not a hunch: a real photo uploaded
through the deployed app got a correct caption saved to the database
("a dining room with a table and chairs") — but the review card kept
showing "No caption yet" indefinitely, because nothing on the frontend
ever re-checked after the card's first render. Root cause: `ReviewQueueCard`'s
local `description` state is a `useState` set once at mount from the
`item` prop and never otherwise re-synced — even a full `refresh()` at the
`OpsConsole` level (which does update the `item` prop with fresh data)
can't reach it, since React doesn't re-run a `useState` initializer just
because props changed. This meant the card was structurally incapable of
ever picking up a late-arriving caption, independent of whether polling
existed. Fixed with two effects: (1) a bounded poll — only while
`lane === 'memory'` and `document_description === null` — calling
`OpsConsole`'s existing `refresh()` (reused via a new `onPoll` prop, not a
new fetch path) every 3.5s for up to 30s, comfortably past jaga-vision's
measured 6-20s; stops itself the instant a caption lands, no separate
success/failure bookkeeping. (2) A sync effect that fills local
`description` from the refreshed `item.document_description` prop, guarded
so it can never clobber a caption the person is already mid-typing or
speaking via the existing voice-caption path. Verified live end to end,
three separate real uploads against the real vision service, not mocked:
captions appeared in the field unprompted at ~6s each; a fully isolated
test (fresh company, zero other pending cards) confirmed polling stops
with zero further `/api/review` requests the instant a caption lands, not
just eventually — the continued requests seen in a non-isolated test
turned out to be several *other*, pre-existing stuck picture-lane
documents from earlier test sessions (some predating jaga-vision's
existence) each independently polling their own 30s window on page
load — expected, bounded behavior per card, not a leak; those stale test
rows are data cleanup, not a code issue. No backend change, no new
dependency. Typecheck + build clean; backend suite re-run as a safety
check even though nothing there changed (39/39). Screenshots:
`docs/screenshots/ops-review-card-caption-poll-before.png`,
`ops-review-card-caption-poll-after.png`.

**i18n plumbing added — EN fully wired through the real app, ZH/TA/MS are structural placeholders only (2026-09-23, DECISIONS #57).** `react-i18next`/`i18next` bundled directly (no HTTP-backend plugin — the app is small enough that async locale loading is pure overhead). `web/src/i18n.ts` initializes a single instance from `web/src/locales/{en,zh,ta,ms}.json` and exposes `setLanguage()`, which calls `i18next.changeLanguage()` and persists the choice to `localStorage` (`jaga-language`). Every static UI string in `OpsConsole.tsx` (all five tabs and every sub-component) plus `Header.tsx`, `LoginPage.tsx`, and `App.tsx`'s skip-link now reads from `t()`, using nested key paths (`ops.review.document.filenameLabel`, not literal text) so a translator works from keys, not guessed English. A compact language `<select>` (EN/中文/தமிழ்/BM) lives in `Header.tsx`'s top-right control cluster. **Two deliberate exclusions**: dynamic backend-sourced text (review reasons, API error messages, filenames) stays untranslated — it's data, not UI chrome; and the fixed `BUCKETS`/`DOC_TYPES` enum values render as literal English since they're matched against backend `Literal` types and FTS5-indexed as-typed — translating their display without breaking that match needs a separate label-mapping layer, not built here. `zh.json`/`ta.json`/`ms.json` are currently English-value copies of `en.json` with identical key structure (programmatically verified) — real translations are an explicit, separate, deferred follow-up (`docs/KANBAN.md` Backlog). The marketing/mock pages (`/`, `/calendar`, `/tags`, `/how-it-works`, `/stack`) are **not yet touched** — also backlogged, deprioritized per instruction since they're logged-out and disconnected from real data (DECISIONS #41). Verified live (Playwright): a real login rendered the Upload & Review/Documents/Dates tabs fully through `t()` with zero console errors; the language switcher changes selection, persists to `localStorage`, and survives a reload. Typecheck + build clean. Screenshots: `docs/screenshots/ops-header-language-switcher-en.png`, `ops-header-language-switcher-zh.png`, `ops-review-tab-i18n.png`, `ops-documents-tab-i18n.png`, `ops-dates-tab-i18n.png`.

**`vision/app.py` now keeps the caption model resident instead of loading it per request — new measured data supersedes DECISIONS #55's reasoning (2026-09-23, DECISIONS #58).** #55's "never keep it resident" decision was based on a ~2GB peak RSS measured on a Mac during development. The real number on the live Lightsail box, under a real captioning call (`systemctl status jaga-vision`), is **~390MB RSS — a 5x difference**, most likely macOS/MPS-backend memory-accounting overhead that doesn't apply to the box's CPU-only Linux build. At ~390MB, keeping the model warm is comfortably affordable on the 4GB box and removes the ~20s per-request load penalty — the actual source of a real user's "captions feel slow" complaint. `BlipProcessor`/`BlipForConditionalGeneration` are now module-level singletons, loaded once at import time (before Uvicorn binds the port, so this genuinely happens at process startup); the `/caption` handler just runs inference against them now. The module docstring's superseded per-request reasoning was rewritten, not left stale next to the new code. `deploy/jaga-vision.service`'s `MemoryMax=2.5G` is unchanged — still comfortably above the real measured footprint — but its comment now explains the cap covers a steady resident baseline plus request overhead, not just a transient per-request spike.

**Frontend backstop**: even with a warm model, the first request after any service (re)start still pays the one-time ~20s load cost. `OpsConsole.tsx`'s `ReviewQueueCard` now derives a precise `isGeneratingCaption` state from its existing DECISIONS #56 caption-poll effect (true only while the poll window is actively running and no caption has arrived — not "forever" if the window later expires) and shows a small spinner + "Generating caption…" line beneath the Description field instead of a bare empty one, using a new i18n key (`ops.review.document.generatingCaption`, DECISIONS #57's foundation).

**Not deployed or verified on the real box** — restarting the live `jaga-vision` service was explicitly out of scope for this task pending a separate go-ahead. What is verified: the backend suite (39/39, unaffected — the existing vision test mocks the `httpx.post` boundary, not `vision/app.py` itself) and the warm-model *pattern*, proven locally (own venv, macOS, not the box): after a clean restart of the local `vision` process, the first successful `/caption` call took **6.37s** and an immediate second call took **0.59s** — confirms the code now behaves as designed (load once, fast thereafter), but these are not the box's real numbers (this Mac already had the model weights cached from #55's original local build, and isn't the box's CPU-only Linux environment) — the ~20s-first/~1-2s-second figures this task expects are Lightsail-specific and still need a real on-box measurement once deployed (`docs/KANBAN.md` Backlog). Frontend typecheck + build clean; the indicator verified live (Playwright, a real `is_picture=true` upload with no vision service running so the poll window stayed active). Screenshot: `docs/screenshots/ops-review-card-generating-caption.png`.

**Header/nav restructure: the real logged-in app is now five URL-addressable
top-level routes instead of one tabbed `/ops` page (2026-09-23, DECISIONS
#59).** The whole real app used to live inside `/ops` as a hand-rolled
tablist (Upload & Review / Documents / Gap Analysis / Obligations / Dates)
with real conditional rendering per tab but no browser history, back/
forward, or bookmark support for any individual section. The header's
signed-in nav is now exactly **Calendar, Tags, Search, Company Files,
Upload**, in that order, each a real path. Calendar and Tags reuse the
*same* URLs as the existing logged-out marketing pages — `pages/Page.tsx`
now calls `useAuth()` and branches: signed-in renders the real page,
everyone else keeps seeing the unchanged mock `CalendarPreview`/
`TagsPreview`. Calendar becomes the "find something by when it matters"
hub — Dates (documents by date, upload/document toggle, unchanged), plus
Obligations, plus Gap Analysis, as three sections on one page (an explicit
decision: none of the three were named individually in the header's
five-item list). Tags becomes a small landing page: six buttons over the
fixed bucket taxonomy, each linking into Company Files pre-filtered via a
`?bucket=` query param — "a fast visual entry point... not a new data
view," per the task's own framing. Three genuinely new routes: `/upload`
(the old Upload & Review tab, moved as-is), `/company-files` (the old
Documents tab minus its search box), `/search` (that search box, promoted
to its own page). `/ops` is kept as a redirect to `/upload`, not removed —
it's the one URL every existing bookmark/phone-home-screen shortcut points
at (DECISIONS #32).

`features/ops/OpsConsole.tsx` (1591 lines, one mount for all 5 tabs) is
deleted. Its content was split, not rewritten: a new `useOpsData` hook
(`features/ops/useOpsData.ts`) fetches the same 4 collections OpsConsole
always fetched together (documents/expectations/obligations/reviewItems);
`RequireSession` (`features/auth/RequireSession.tsx`) is the session-gate-
and-redirect logic OpsConsole used to inline, now shared across every page
that needs it; `OpsStatusBar` is the "backend reachable / company · email ·
role" line, now repeated at the top of each page instead of rendered once;
`opsShared.tsx` holds the small cross-cutting pieces (`DocTypeField`,
`VoiceCaptionButton`, `PictureToggleField`, `StatusPill`, the blob-URL
fetch hook); `ReviewQueueCard.tsx`, `DocumentCard.tsx` (+ `DocumentViewerModal`,
`DocumentThumbnail`), and `features/calendar/DatesView.tsx` are the same
components, unchanged, just moved out of the monolith into their own
files; `DocumentResultsList.tsx` is a new small shared wrapper (list +
trace table + viewer modal) used by both the Company Files and Search
pages, since that wiring was duplicated between them otherwise.

**A real, separate router bug was found and fixed in the process, not
just this task's own redirect**: a component that calls `navigate()` from
its own first-mount effect races `useRoute`'s `popstate` listener — React
commits a child's effects before its parent's, so on a fresh page load,
`useRoute`'s listener (attached in `App`'s own effect) isn't attached yet
when a *descendant* component's first-mount effect fires `navigate()`
synchronously. The `/ops`→`/upload` redirect silently no-op'd on a fresh,
hard-loaded (bookmarked) visit as a direct result — confirmed live via
Playwright: the URL changed to `/upload`, but the rendered route and
`document.title` both stayed stuck on `/ops`'s old "Your documents," and
`#main`'s actual DOM content was empty (`<div style="opacity: 1;"></div>`,
nothing inside it). Fixed by rewriting the URL in `main.tsx`, before React
ever mounts, so `parsePath` never sees `/ops` as the live pathname at all
— the `OpsRedirect` component is kept only as a defensive fallback for a
theoretical client-side arrival at that route, which no in-app link
produces anymore (`Header.tsx` and `LoginPage.tsx` were both repointed
from `routeHref('ops')` to `routeHref('upload')`).

**Disclosed tradeoffs, not fixed here**: navigating between Upload/
Company Files/Calendar now re-fetches all 4 collections on each landing,
where the old single OpsConsole mount fetched once and kept tab switches
free — the direct, necessary consequence of "separate top-level routes,"
not a bug. Search's vendor-name autocomplete is scoped to the current
result set only, not the full company list like Review/Company Files —
deliberately smaller scope so this one new page didn't need its own bulk
fetch just for one dropdown. The Tags landing page's own one-line intro
sits directly under the *marketing* page's existing subtitle text
(`ROUTES.tags.description`, shared by both variants at that path) — a
little redundant wording, not incorrect (`docs/KANBAN.md` Backlog). The
header's "Get Started" CTA still points a signed-in user at the marketing
`/calendar` page, unchanged — out of this task's explicit scope.

Verified live end to end (Playwright, real login as the seeded demo owner
`owner@try-demo.test`, real documents already in that company — not
mocked): signed-out `/calendar`/`/tags` render the unchanged marketing
preview; the signed-in 5-item nav appears in the right order; Company
Files' bucket chips and the Tags landing page's six buttons both correctly
deep-link via `?bucket=`; Search returns real results with working view/
trace/archive; the Calendar hub renders all three merged sections (Dates,
2 Obligations, Gap Analysis 2 of 6 held) with real data; a hard-loaded
`/ops` now correctly lands on a fully-rendered, correctly-titled `/upload`.
Zero browser console errors across the whole pass. `npm run typecheck`/
`npm run build` both clean. No backend change, so the backend suite wasn't
re-run.

**Five Company Files / bucket-picker fixes from live user feedback
(2026-09-23, DECISIONS #60), all display-only or client-side-gating — no
backend/data-model change.** (1) Every document card (Company Files,
Search) now shows "Upload date" and "Document date" — the exact wording
already established by the Calendar page's Dates view, reused rather than
invented a second time — with a plain "No document date" state when
`occurred_on` is null. (2) Trace (confirmed via a direct user question,
"what is trace btw?", to be an agent-debugging view nobody but a
developer needs day to day) moved out of the primary action row into a
small "⋯" overflow menu — confirmed via grep it's the only place it was
reachable, so it's still fully reachable, just de-emphasized. (3)
`StatusPill` now renders nothing at all for `filed`/`processed` — fixed
centrally in the one shared component, so this also applies to the
Calendar hub's Dates rows, which show the same badge. Every exceptional
status (`needs_review`, `quarantined`, `open`, `missing`) is unaffected.
(4) **"Archive" is now "Delete" everywhere it's user-facing** — an
explicit, confirmed decision: the action is already functionally
permanent from the app's own perspective (DECISIONS #53), so "Archive"
implied a recoverability nobody using the app actually has. The internal
name is deliberately unchanged (`opsApi.archiveDocument`,
`POST /api/documents/{id}/archive`, `status='archived'`) — a code comment
at the endpoint now says so explicitly. A new shared
`components/ui/ConfirmDialog.tsx` ("Delete {filename}? This can't be
undone.") gates both call sites (Company Files/Search action row, the
review card's expired-review escape hatch) — nothing fires on the first
click anymore. (5) The Bucket `<select>` (review card, Company Files edit
form) is now a row of single-select pill buttons (`PillPicker`,
`opsShared.tsx`) over the same fixed 6 values — live feedback: "should be
buttons... easier to select than drop down." `doc_type`'s dropdown was
converted the same way while already in that code (the statutory lane's
free-text exception is untouched).

**No automated test for the delete-confirmation flow, despite the task
asking for one** — `web/package.json` has no test runner at all (no
vitest/RTL, confirmed by reading it fresh before starting); adding one
would have meant standing up frontend test infrastructure first, a
separate, much bigger task not requested here and already an open
`docs/KANBAN.md` Backlog item. Verified live instead (Playwright, real
login, real backend, network-request interception): opening the dialog
and clicking Cancel fires zero `POST .../archive` requests; clicking
Delete fires exactly one and the document disappears from the list.
Verified live end to end (`owner@try-demo.test`, 17 real seeded
documents): dates render on every card across Company Files and Search; a
previously-"FILED" document now shows no badge at all, `needs_review`/
`quarantined` unaffected, same suppression visible on the Calendar hub's
Dates rows; the overflow menu opens and Trace still renders the same
trace table it always did; Bucket and doc_type both render as pill rows
with the correct value pre-selected in both the review card and Company
Files' edit form. Zero console errors. `npm run typecheck`/`npm run build`
both clean. Screenshots: `docs/screenshots/company-files-dates-and-delete.png`,
`company-files-overflow-menu.png`, `company-files-edit-pill-pickers.png`,
`company-files-delete-confirm-dialog.png`, `calendar-dates-no-filed-badge.png`,
`search-dates-and-delete.png`.

**Real Chinese/Malay/Tamil translations replace DECISIONS #57's English-value
stubs (2026-09-23, DECISIONS #61)** — landed as a direct commit just before
this session (`web/src/locales/{zh,ms,ta}.json`), documented here
retroactively since it shipped without its own decision row. No key/
structure changes. Verified this session, not re-translated: all three
files are valid JSON, 0 of 123 keys are still byte-for-byte identical to
`en.json`, and the existing i18n wiring renders them correctly with no
code change (confirmed live via the language switcher). Enum display
values (`BUCKETS`/`DOC_TYPES`) and dynamic backend-sourced text remain
untranslated by design, unaffected by this — see DECISIONS #57.

**Mobile-first header (top bar + bottom nav) and a real Calendar month
grid — two real, screenshot-confirmed mobile bugs fixed in one pass
(2026-09-23, DECISIONS #62).** (1) At 375px on real Android Chrome,
`Header.tsx`'s logo, five nav items, language selector, email, and Log Out
all fought for one row and visibly overlapped/wrapped, confirmed by
screenshot. Fixed with a responsive split: the existing inline nav/email/
Log Out now render from `sm:` up only when signed in; a new
`sections/BottomNav.tsx` carries the same five destinations (Calendar,
Tags, Search, Company Files, Upload) as icon+label items fixed to the
bottom of the viewport on phones, with Upload pulled into a raised center
"+"-style button (the reference pattern the task pointed at, and the
single most common action) — the other four keep `OPS_NAV_ROUTES`'
relative order, split two-and-two around it. A new `UserMenu` inside
`Header.tsx` collapses company/email/role/Log Out behind one account-icon
button + dropdown on phones; desktop is untouched. `App.tsx` was split
into `AppContent` (a child of `AuthProvider`, so it can read session
status) so both the bottom nav and the page's own bottom padding
(`pb-24 sm:pb-0`, keeping the fixed bar from covering the last item) key
off `status === 'signed-in'`. Nav icons (`CalendarDays`/`Tag`/`Search`/
`FileText`/`Upload`) are all already imported elsewhere in this app
(`RouteCta.tsx`, `TagsPreview.tsx`, `DocumentCard.tsx`, `UploadPage.tsx`)
— no new icon set added, though `DocumentTypeIcon` below does add one new
icon (`Image`) from the same already-used `lucide-react` package.

(2) Calendar's "Dates" section (`DatesView.tsx`) was a flat scrolling
list whose rows showed the raw, truncated filename
("179014556051314855...") instead of anything meaningful, and didn't read
as a calendar at all — also confirmed, real. Replaced with a real month
grid (new `features/calendar/MonthGrid.tsx`: weeks as rows, days as
cells, a compact count badge per day with documents; month math via three
new `lib/dates.ts` helpers — `startOfMonth`/`addMonths`/`daysInMonth`)
with the tapped day's entries listed below it. Each entry uses a new
shared `formatDocumentLabel()` (`features/ops/opsShared.tsx`): vendor
name + doc type (e.g. "Lay Meng Engineering — invoice"), falling back to
description, then doc_type alone — never the filename — plus a small
file-type icon (`DocumentTypeIcon`, image vs. everything else via
`media_type`). The upload/document toggle keeps its exact existing
behavior, just repositioned above the grid.

**Found, deliberately not silently "fixed"**: the task's premise that
this label format "mirrors what Company Files already does" doesn't
match the actual code — `DocumentCard.tsx`'s header shows `description`
first (a deliberate, already-shipped DECISIONS #52 choice, not a bug),
not vendor+doctype. `formatDocumentLabel()` is used by the new Calendar
rows only; Company Files was left untouched rather than silently
overriding a prior, reasoned, already-verified-live decision based on a
mistaken premise in the task prompt — flagged in `docs/KANBAN.md` Backlog
for an explicit call on whether to unify.

Verified live end to end (Playwright, real login as `owner@try-demo.test`,
real seeded data, 375×812 viewport + an Android Chrome user agent):
before/after screenshots captured against the actual pre-change code (via
a temporary `git stash`, popped immediately after) confirm both the
header overlap and the raw-filename flat list in the old code, and their
absence in the new code; the month grid shows real per-day counts (6/6/4
for three real seeded days in September 2026); a tapped day's full 6-row
detail list was verified via DOM text extraction (not just a screenshot
crop) to confirm no rows were silently dropped. Zero browser console
errors throughout. `npm run typecheck`/`npm run build` both clean. No
backend change. Screenshots: `docs/screenshots/mobile-header-before.png`,
`mobile-header-after.png`, `mobile-bottom-nav-account-menu.png`,
`calendar-month-grid-before.png`, `calendar-month-grid-after.png`,
`calendar-day-detail.png`.

**A second live 375px bug report the same day (BM + EN), six Calendar
findings plus a real BM/Tamil i18n audit of the signed-in app's bucket/
doc_type/role/risk display values (2026-09-23, DECISIONS #63).** All six
Calendar items came pre-checked with file:line references from the
reporting session; every one was re-verified live at 375px against the
actual current code before any change — three items turned out to need
different handling than a literal read of the report would suggest.

Fixed: **(1)** the count-badge overlapped the date number on a day cell —
root cause confirmed by reproducing and reading the box model, not just
theorized: the badge `<span>` used `flex` (block-level), and a block box
with no explicit width defaults to the *full width* of its non-flex
parent, so it stretched edge-to-edge over the number (`min-w-4` only
floors the width, doesn't cap it) — `MonthGrid.tsx`'s day button is now
`flex flex-col items-start`, fixing every day cell, not just the
selected/ringed one the report screenshotted. **(2)** the selected-day
heading always read in English — `lib/dates.ts`'s `formatShortDate`
hardcoded `'en-GB'`; `MonthGrid.tsx` had already solved this for its own
chrome with a private locale map, moved into `lib/dates.ts` as the one
shared spot instead of a second copy (`formatShortDate`'s new `locale`
param defaults to `'en-GB'`, so its other two callers — the deliberately
unlocalized marketing preview, DECISIONS #57 — are unaffected). **(3)**
`DocumentTypeIcon` now distinguishes image/PDF/spreadsheet/generic-
document (confirmed live against the real DB that only PDF/JPEG occur
today, but `app/graph/ingest.py` has no server-side type allowlist, so
this is deliberately defensive); the report's second ask here — show the
filename too — was in real, named tension with `formatDocumentLabel()`
(written earlier the same day specifically to stop a raw-filename bug,
DECISIONS #62). **Resolved, not silently picked**: the primary label is
unchanged (`formatDocumentLabel()`'s contract holds for any other
caller), the filename is added as small muted secondary text underneath
in `DateGroupRow` — filename-as-supporting-detail, not a reopening of the
original bug. **(5)** `OpsStatusBar.tsx`'s "company · email · role" row,
which resolves async from `/api/auth/me`, now reserves its height with a
skeleton while `status === 'loading'` instead of leaving a blank gap —
confirmed the mechanism by reading (`AuthContext.tsx`), but a local timed-
reload test couldn't reproduce a visible gap, since this repo's backend
answers in single-digit milliseconds on localhost; the real gap scales
with the real cross-origin hop to Lightsail (DECISIONS #32), which is
exactly what would produce two differently-timed screenshots from a real
phone. **(6)** day-detail rows are real `<button>`s now, opening the same
`DocumentViewerModal` Company Files/Search already use
(`DocumentResultsList.tsx`'s `viewingDocument`-state pattern, reused, not
rebuilt), with a trailing chevron as the tap affordance.

**(4) verified live, not reproduced — no code change**: `DatesView.tsx`'s
empty-state logic (no-selection hint, "no documents on this day", the
`noDate` section under the `document` basis) was already correct,
confirmed via a DOM dump (not just a screenshot, which can visually read
as blank against white) — matches the reporting session's own hedge that
this might already be fixed.

**i18n audit (7/8)**: new `bucketLabel`/`docTypeLabel`/`roleLabel`/
`riskLabel` accessors plus a shared `BucketField` (mirrors the existing
`DocTypeField`) in `opsShared.tsx` — same "translate display, never the
stored/DB/API value" rule `StatusPill` already established, each falling
back to the raw value for anything unmapped. Fixed every site on the
report's own list (`OpsStatusBar.tsx`, `Header.tsx`'s `UserMenu`,
`DatesView.tsx`, `DocumentCard.tsx`, `CalendarHub.tsx`'s `ob.risk`,
`DocTypeField`'s pill text) plus three more found by grepping every real-
app page: `CompanyFilesPage.tsx`'s bucket-filter chips, `TagsLanding.tsx`'s
six bucket buttons (only the *displayed* text — the `?bucket=` query
value stays the raw English constant), and `pages/NotFoundPage.tsx` (a
real page reachable signed-in and signed-out, zero i18n wiring, not
actually a marketing-preview page despite living next to some in the
file tree). **Found, not fixed**: `DocumentCard.tsx`'s header fallback
still shows raw `doc.lane` — no existing key infrastructure for that
vocabulary, and it's only the last-resort label when both `description`
and `doc_type` are empty (`docs/KANBAN.md` Backlog). **Scope tension,
flagged rather than resolved unilaterally**: the report's own phrasing
("audit ALL pages in BM and Tamil") reads as including the logged-out
marketing pages, which DECISIONS #57 already explicitly and repeatedly
deprioritized (`docs/KANBAN.md` Backlog) — re-audited here (still
untranslated, confirmed by grep) but not translated, since reversing an
explicit prior priority call isn't a decision to make silently mid-bugfix.

Verified live end to end (Playwright, real login, 375px, EN + BM +
partial Tamil, zero console errors before and after): the badge-overlap
fix screenshotted directly (before/after crops); the BM heading renders
via a real `ms-MY` `Intl` call, not a hardcoded string; a tapped row
opens the real viewer (the first verification attempt used too broad a
selector and clicked a `MonthGrid` button instead — caught and fixed
before trusting the result); bucket/role/risk translations confirmed on
Company Files (list badges and the edit-form pills), the Tags landing
page, and the Calendar hub, in BM. `npm run typecheck`/`npm run build`
both clean throughout. No backend change. Screenshots:
`docs/screenshots/calendar-badge-overlap-before.png`,
`calendar-badge-overlap-after.png`, `calendar-day-heading-localized-bm.png`,
`calendar-tappable-row-viewer.png`, `calendar-empty-no-selection.png`,
`calendar-empty-zero-docs.png`, `calendar-icons-image-vs-pdf.png`,
`company-files-bucket-chips-bm.png`, `company-files-edit-pills-bm.png`,
`tags-landing-bm.png`.

**Logged-out landing page + all four roles actually enforced and testable
end to end — a real feature, the first round of the day to touch backend
authorization, not a bug fix (2026-09-23, DECISIONS #64).** Full
role × action matrix, and the three real ambiguities in the request
resolved and recorded (not silently picked): `docs/PERMISSIONS.md` — not
repeated in full here.

**Landing**: `Page.tsx`'s `home` case rendered `<Hero/>` unconditionally —
confirmed live, a signed-in visitor to `/` saw the marketing hero instead
of the app, unlike `calendar`/`tags` (already session-branched). Fixed
with the same bare mount-effect pattern `/ops`'s redirect already uses:
signed-in → `HomeRedirect` → `/calendar`; signed-out → a new, deliberately
minimal `WelcomeHero.tsx` (heading, one line, Sign in + Get started, both
routing to `/login` per the explicit ask, not `GetStartedPage`) — no
search demo, no marketing CTAs, no scroll. `Hero.tsx` deleted (confirmed
via grep it was `/`'s only caller) rather than left as dead code;
`MemorySearch.tsx` (used only by the now-deleted `Hero.tsx`) was **not**
cascade-deleted — flagged in `docs/KANBAN.md` instead of chased down
further, a bigger side-quest than this task asked for. Footer suppression
needed no new code (`App.tsx` already hides it for `route === 'home'`).

**Permissions** (ground truth already existed — `ROLE_ORDER`/
`require_role` in `app/auth.py`, `document.uploaded_by_user_id` in
`app/db.py` — this closes enforcement gaps, it doesn't build a new
model): `PATCH /api/documents/{id}` (`edit_document`) gained an ownership
check — a `user`-role account may now only edit a document they
themselves uploaded (admin/owner unaffected; a document with no recorded
uploader, e.g. pre-existing seed data, stays editable by any `user`+,
since there's no real uploader to protect it from). New
`PATCH /api/companies/{id}` (`edit_company`, owner-only), scoped to
`name`/`fye_month`/`fye_day` — the company row was previously write-once
at signup; `CompanyOut` (`dev_login`/`/api/auth/me`) had to gain
`fye_month`/`fye_day` for the first time so the new settings page has
something to show before a save. `resolve_review` was deliberately **kept
admin-only**, not extended to let a `user` resolve their own upload's
review item despite the surface symmetry with the new edit rule — the
review queue is this product's human-in-the-loop safety check
(DECISIONS #40), and two of its own checks (#33, #48) exist precisely
because trusting the uploader's or the model's self-report alone was
already proven unsafe on this codebase; letting the uploader also clear
their own flagged upload would remove the second pair of eyes that's the
actual point. **Found, not fixed**: `GET`/`POST /api/companies` have no
session or role check at all — confirmed pre-existing and genuinely
unused (no frontend/script/test caller) by grep, flagged in
`docs/KANBAN.md` rather than fixed inside an already-large scope.

**Seeding**: `scripts/seed_dev_db.py` now always ensures one account per
role (`admin@`/`user@`/`viewer@try-demo.test`, alongside the existing
`owner@`) exists — via the already-idempotent `add_member` +
rejoin-`dev-login` endpoints, no new endpoint needed — and prints all four
tokens even on a re-run of an already-seeded company (the old code
returned early before reaching that point on that path).

**Nav + role chip**: `Header.tsx`'s new `visibleNavRoutes(role)` hides
Upload for `viewer` (already 403'd server-side) and appends Company
Settings for admin+ — resolving a real contradiction in the request (one
part implied admin can reach the settings page, another implied the nav
entry is owner-only; both can't be true — the entry is visible to
owner+admin, the fields stay owner-only editable, the only reading under
which "admin sees it read-only" is a reachable UI state).
`BottomNav.tsx` reads `role` directly from `useAuth()` (no new prop
plumbing) and, for `viewer`, drops the raised center Upload button and
reflows the remaining four into one plain even row. A persistent role
chip (`Badge`, always visible beside the avatar button, not just inside
the opened dropdown) and a Company Settings link inside that same
dropdown (own resolution: the bottom nav has no room for a conditional
sixth slot, so the already-mobile-only account menu is where a mobile
owner/admin actually reaches the page) both live in `Header.tsx`'s
`UserMenu`.

Verified live end to end, not just by unit test: two new backend tests
(`tests/test_auth.py` — ownership: uploader edits own doc 200, a
different `user` 403, admin/owner unaffected, a `NULL`-uploader doc stays
editable; company settings: admin 403, owner 200 and persists, plus the
exact paired contrast the request named — the same admin session's
`POST .../archive` succeeds (200) immediately next to its
`PATCH .../companies` failing (403)) — full suite 41/41. The same paired
contrast was also re-run live via `curl` against the real running
backend (not just pytest), with a second real `user`-role account created
for the cross-user case since the seed script only creates one per role:
admin PATCH company settings → 403; viewer POST upload → 403; a
different `user` PATCHing someone else's fresh upload → 403; that
document PATCHed by its actual uploader → 200; admin archiving it → 200;
the same admin session's company-settings PATCH → 403 again. Frontend:
`npm run typecheck`/`npm run build` clean; Playwright at 375px for the
landing page and each of the four seeded roles' Calendar view (role chip,
nav differences, bottom-nav reflow for viewer all confirmed), plus
desktop-width nav screenshots (owner sees Company Settings, user
doesn't), the mobile account-menu's Company Settings link, and a real
settings save confirmed to propagate to the Calendar page's own
company-name display via a new `refreshCompany()` on `AuthContext`. Zero
console errors across all four role sessions. Screenshots:
`docs/screenshots/landing-page-signed-out.png`,
`role-owner-calendar-375.png`, `role-admin-calendar-375.png`,
`role-user-calendar-375.png`, `role-viewer-calendar-375.png`,
`nav-owner-company-settings-visible.png`,
`nav-user-no-company-settings.png`,
`mobile-usermenu-company-settings-link.png`,
`company-settings-owner-editable.png`, `company-settings-admin-readonly.png`,
`company-settings-saved-confirmation.png`.

**Not deployed**: this round changed the backend (two new/changed
endpoints, two new Pydantic model fields) — Vercel auto-deploys the
frontend half on push per the standing convention, but **Lightsail needs
an explicit redeploy to pick up the backend change, not done here**
pending a separate go-ahead.

**A real live-mobile-testing regression report, root-cause chain traced
and fixed — built, tested, and verified, but deliberately NOT committed
or pushed this round on an explicit one-off instruction to wait for a
go-ahead first (2026-09-23, DECISIONS #65).** All four items were
investigated against the actual current code before any change (matching
the report's own file:line references), and one item needed real
empirical testing, not just a code read, to actually confirm.

**(1) Marketing footer inside the signed-in app** — `App.tsx` rendered
the full marketing `<Footer/>` (tagline, Product/Solutions/Resources/
Company columns with links like "Founders"/"Status" that don't
correspond to anything in the product, social icons) on every signed-in
page, confirmed live; it also has zero i18n wiring, which is what
actually surfaced it (untranslated footer text under a fully-translated
page). **Resolved as a real product decision, not a translation gap: the
footer is now removed from the signed-in app entirely** (gated on
`status !== 'signed-in'` instead of `route !== 'home'`) — the same call
the landing page (DECISIONS #64) already made, for the same reason.
Verified footer still renders correctly on every signed-out page
(`/login`, `/stack`).

**(2) EXIF-rotation OCR fix, confirmed real and severe via an actual
empirical test, not just a code read** — `app/extract/ocr.py` opened
images with plain `PIL.Image.open()` and fed them straight to Tesseract,
with no `ImageOps.exif_transpose()` call anywhere; a portrait phone photo
commonly stores landscape pixels plus a rotation flag, which PIL does
*not* auto-apply the way a browser does. Built a synthetic portrait
invoice photo (landscape-stored pixels + a genuine EXIF Orientation=6
tag) and ran it through the real OCR function before/after the fix:
**unfixed, 44 chars of unusable garbage; fixed, 126 chars of the real
invoice text** (vendor, invoice number, date, amounts), matching a
control image almost exactly. **Then re-verified end to end against the
real LLM gateway** (a real, small cost — ~$0.019, the same "one targeted
live call" precedent this project's history already establishes
repeatedly, e.g. DECISIONS #42/#48/#56): uploaded the same synthetic
sideways image through the actual running backend — classified as a real
invoice (95% confidence, a genuine `sonnet4.5` call, not the memory-lane
fallback), extracted a full clean field set (vendor "Lay Meng Engineering
Pte Ltd", date 2026-09-20, amount $546.00), filed as "clean extraction."
**Caveat stated plainly, not glossed over**: this fix mainly protects
upload paths that bypass the frontend's own normalization —
`web/src/lib/imageNormalize.ts`'s own docstring already states
`createImageBitmap()` applies EXIF-orientation correction by default in
every shipping browser, so a real photo uploaded through the actual web
UI should already arrive upright. If the live regression persists for a
*web-uploaded* photo after this fix, the more likely explanation is the
separate, already-known, already-deferred gap this same file's own
history flags (no deskew/crop/quality preprocessing at all,
`docs/KANBAN.md` Backlog) — not EXIF rotation. New test: `tests/test_ocr.py`
(skips gracefully if Tesseract isn't installed on the machine running the
suite).

**classify.py's system-prompt-adherence gap was deliberately left alone**
— the report's own screenshot showed the model commenting on OCR quality
despite its system prompt explicitly forbidding it. Without a way to test
a prompt change against the real model without spending real gateway
calls on unverified guesses, item (3) below's new deterministic backstop
was judged the safer, actually-testable fix instead.

**(2c) The picture-toggle/doc-type contradiction — confirmed a real,
structural bug**: `DocTypeField`'s pill picker (`opsShared.tsx`) had zero
relationship to the picture toggle — a reviewer could pill-select
"Invoice" on a `lane='memory'` document with nothing preventing or
flagging it, in both `ReviewQueueCard.tsx` and `DocumentCard.tsx`.
**Resolved: the doc-type picker now locks (disabled, all pills greyed
out except the already-selected "Photo", with a small explanatory note)
whenever the picture toggle is checked** — chosen over the alternative
(unchecking the picture toggle when a doc-type pill is picked) because
it's consistent with the toggle's own already-shipped, one-directional
design (DECISIONS #52: once marked memory, there's no reclassify-back-out
path), not a second, contradictory direction of control. Server-side,
`is_picture=true` already deterministically overrides `doc_type` to
`'photo'` on save (`DocumentEditRequest`'s docstring) — this just stops
the UI from implying a choice that was never real.

**(3) Review was structurally incapable of flagging a document that was
never actually read** — confirmed by reading `verify()` in full: a
document on `lane='memory'` never reaches `extract_result` (extract.py
only runs for invoice/statutory lanes), so none of the invoice-specific
checks ever ran, and nothing else in the function looked at
`classify_result`'s own confidence or description text. Three new
deterministic checks added to `app/graph/verify.py`: `_check_classify_confidence`
(catches classify.py's own confidence=0.3 no-OCR-text fallback — the
exact mechanism a sideways/unreadable photo falls into),
`_check_description_signals_problem` (a plain-text heuristic catching the
system-prompt-adherence slip above after the fact — "unreadable"/
"corrupted"/"unclear"/"illegible"/etc.), and `_check_required_invoice_fields`
(defensive — `InvoiceFields`' vendor/issued_on/total are already
non-optional Provenance fields today, so this mainly guards a future
schema change). **Broke two pre-existing tests on first run**
(`test_verify_clean_extraction_still_needs_review_not_filed`,
`test_verify_does_not_flag_amounts_that_do_appear_in_source_text`) — both
used minimal hand-written `extract_result` fixtures missing `issued_on`,
which a real Pydantic-validated extraction always has; fixed by
completing the fixtures to match the real schema shape, not by weakening
the new check. Three new unit tests
(`tests/test_rules_smoke.py`) plus a new eval case
(`evals/cases/adversarial/unreadable_document.yaml`, 4 cases, wired into
`evals/run.py` alongside the existing injection/GST adversarial suites —
the exact pattern the report asked to follow).

**(4) The review message was shown twice for one upload** —
`UploadPage.tsx`'s "Last upload result" banner repeated
`ReviewQueueCard.tsx`'s full question text immediately above the same
card now showing it again in the Needs Review list, confirmed live.
**Resolved: the review card owns the message**; the banner now shows a
short pointer ("Needs review — see below.") instead of the full text —
chosen over dropping the banner line entirely, since a reviewer still
gets immediate feedback that something happened without re-reading the
same sentence twice.

Verified live: `pytest tests/` 45/45, `python evals/run.py` 14/14
adversarial (including the 4 new unreadable-document cases),
`npm run typecheck`/`npm run build` clean (`dist/manifest.webmanifest`
confirmed present — this repo has no separate PWA-specific check, and no
`lint` script exists yet, both pre-existing tracked gaps,
`docs/KANBAN.md` Backlog), zero browser console errors. Playwright at
375px confirmed: zero `<footer>` elements on `/upload` (signed-in) vs. 1
on `/login` and `/stack` (signed-out); a real UI upload of the sideways
test photo showing the banner's short message with no duplication below
it; a picture-lane review card's doc-type pills genuinely disabled with
"Photo" pre-selected and the explanatory note visible. Screenshots:
`docs/screenshots/regression-footer-removed-signed-in.png`,
`regression-no-duplicate-review-message.png`,
`regression-doctype-locked-to-photo.png`.

**A second live-mobile regression round (11 items), arriving on top of a
since-fixed stale Lightsail deploy — built, tested, and verified, but
deliberately NOT committed or pushed this round either, same one-off
wait-for-go-ahead instruction as #65 (2026-09-23, DECISIONS #66).**
Opening context, not this round's own finding: the reporting session's
own earlier Lightsail deploy had gone stale (a 422-line `main.py` live on
the box vs. the real 785-line file, missing endpoints entirely including
file-serving) — they found and fixed that themselves, verified live, and
cleaned up 32 orphaned temp files directly on the box. Several of the
originally-reported symptoms (items 1/2/6 below) are most plausibly
explained by that stale deploy alone — a missing file-serving endpoint
reads exactly like "photos vanished" — not a code bug in this repo; this
local session has no way to reach the live box to confirm that
attribution directly, so it's stated as the most likely read of the
evidence, not a verified fact.

**(11) Temp-upload-file leak — confirmed live, fixed.**
`app/main.py::upload_document` wrote every upload to a
`tempfile.NamedTemporaryFile(delete=False, ...)` and never cleaned it up
on any path — confirmed on the live box, 32 orphaned files against 31
real documents, a 1:1 leak on every single upload. Fixed by wrapping the
whole handler body in `try/finally`, with `Path(tmp_path).unlink(missing_ok=True)`
in `finally` so it fires on every exit, not just the happy path a single
trailing line would have missed.

**(1/2/6) "File missing" and "no issues found" showing at the same
time.** Nothing in the pipeline ever checked file-existence as its own
condition, so a review card could show a clean "no issues found" for a
document whose file was gone. New `app/graph/verify.py::_check_file_exists`
queries `document.stored_path` and, when the file is missing,
**overrides** `reasons` entirely (not appends) — structurally, not just
by chance, the two states can no longer coexist. A distinct red
headline ("File missing — delete or re-upload this document.") renders
in `ReviewQueueCard.tsx` via an exact-match on the new reason string.
**A real, separate bug found and fixed while adding this**: the shared
test fixture `_seed_company_and_document` (`tests/test_rules_smoke.py`)
hardcoded `stored_path = '/tmp/x'` for every one of 15+ existing test
call sites — harmless until a real file-existence check existed, at
which point every one of those tests' pass/fail depended on whether a
stray `/tmp/x` file happened to already exist on the machine running the
suite (confirmed one did here, left over from an earlier session — which
would have silently hidden a real failure on a clean CI box). Fixed to
write a real, unique, guaranteed-fresh temp file per call.

**(3) Vendor field not prefilled.** `ReviewQueueCard.tsx`'s editable
Vendor field initialized from `document.vendor_name` (`classify.py`'s
separate, optional, often-null guess) while the value extraction
actually found lives in a different structure entirely,
`extract_result.vendor` (`extract.py`'s dedicated invoice-lane field,
with its own provenance/confidence) — the two were never reconciled.
Fixed: the extracted value now wins when present, `document.vendor_name`
is the fallback, not a second source assumed to already agree. Confirmed
live on a real invoice: the field now shows the real extracted vendor
name instead of arriving blank.

**(4) Zero-amount invoices.** The existing `_check_required_invoice_fields`
(DECISIONS #65) only checked for `None`/missing — `0` passed as
"present." New check alongside the existing GST-arithmetic check:
subtotal/GST/total all exactly zero (small tolerance for float noise) is
now flagged as an implausible failed read, not silently accepted as a
real zero-value invoice. EXIF-rotation (DECISIONS #65) re-confirmed
unchanged by re-reading the code — re-verifying it live *on the box*
specifically is out of this local session's reach. Date/year: agreed
with the reporting session's own conclusion — no code-level year-parsing
bug found (`issued_on` is a raw LLM string, never routed through
fragile date-format code); not touched.

**(5) Dead upload button.** The bottom-nav's raised center Upload FAB
(`BottomNav.tsx`) was a plain `<Link>`, so tapping it while already on
`/upload` did nothing next to the page's own working dropzone.
**Resolved: wired to trigger the file picker directly** when already on
that route, chosen over just de-emphasizing it — a plain `window`
`CustomEvent` (new `lib/uploadTrigger.ts`), not a new React Context,
since this is a single fire-and-forget signal between two components
with no shared parent worth threading state through.

**(7) Golden-path eval cases — not actioned, flagged back.**
`evals/cases/golden/` needs real labelled documents; the ones referenced
aren't accessible from this local session (not present in this repo, no
live-Lightsail access from here), and this project's own established
privacy policy (`WINNING.md`) deliberately keeps the team's real
corporate documents out of the repo in favor of the synthetic demo
corpus. Populating this needs the user to either supply the specific
files directly or confirm they're fine overriding that policy — a
genuine decision blocker, not something to guess at.

**(8) Singapore-style dates.** `lib/dates.ts` already had a locale-aware
`formatShortDate` (DECISIONS #63) producing exactly this shape; the gap
was that `CalendarHub.tsx`'s raw `{ob.due_on}` and `DocumentCard.tsx`'s
own private `dateOnly()` helper (a bare `.slice(0, 10)`) never called it.
Wired both into the existing formatter instead of building a second one.
**A real bug caught live while wiring this, not shipped blind**:
`document.received_at` is a full SQLite `datetime('now')` string
("2026-09-23 10:58:35"), not a bare date — `parseIsoDate`'s `'-'`-split
on the full string produced a `NaN` day component, silently rendering
"Invalid Date" everywhere, caught via a screenshot before being reported
done. Fixed at the source (`parseIsoDate` now slices to the first 10
characters before parsing), protecting every current and future caller,
not just the two call sites this task touched.

**(9) Confidence scores hidden from users.** The raw `(87%)` next to
every extracted field (`formatConfidence`) is removed from what the user
sees; the same existing `< 0.6` floor still decides which fields get a
flag, now rendered as a short "(please check)" instead of a number — no
badge at all above the floor. `formatConfidence` deleted entirely (zero
remaining callers). Universal review / no auto-pass — **confirmed
already true, not rebuilt**: `verify()`'s `needs_review = True` is
unconditional (DECISIONS #40), the only fully-automatic path is the hard
injection-quarantine case.

**(10) Reject vs. delete — reproduced live, no visible discrepancy
found.** Read the reject flow first and found one real code gap
(`setBusy(false)` missing on the success path, every other exit already
resets it) with no proof it has any visible effect — the card unmounts
via the parent's refresh before a stale busy state could ever render.
Reproduced live, side by side, at the network-request level: reject
fires exactly one `POST .../resolve`, the card leaves the DOM cleanly,
the "rejected and archived, upload a replacement?" banner (DECISIONS
#50) appears correctly, zero console errors — the same clean shape
delete already has. Stated plainly: could not reproduce the described
discrepancy despite trying the reporting session's own suggested
side-by-side comparison; fixed the `setBusy` gap anyway for correctness,
not because a symptom was confirmed.

Verified live: `pytest tests/` 47/47 (2 new tests for items 1/2/6 and 4,
plus the fixture fix), `python evals/run.py` 14/14 adversarial
(unchanged), `npm run typecheck`/`npm run build` clean, zero console
errors across every flow tested, 3 real uploads through the live
endpoint confirmed zero new orphaned temp files afterward (previously
would have been 3). Screenshots:
`docs/screenshots/regression2-file-missing-headline.png`,
`regression2-reject-replacement-prompt.png`,
`regression2-calendar-sg-dates.png`,
`regression2-company-files-sg-dates.png`,
`regression2-vendor-prefill-no-confidence.png`.

**A third live-mobile regression/cleanup round (11 items) on the
upload/review flow — built, tested, and verified, but deliberately NOT
committed or pushed this round either, same one-off wait-for-go-ahead
instruction as #65/#66 (2026-09-23, DECISIONS #67).** Opened noting the
reporting session's own earlier deploy issue was already fixed and the
Lightsail box confirmed correctly live.

**(1) Reject = delete, one terminal state.** Investigated first, not
assumed a bug: `GET /api/documents` already excludes
`status != 'archived'` unconditionally (DECISIONS #53), reject already
chains straight through to `archived` (DECISIONS #50), and `StatusPill`'s
status maps have no `rejected` entry at all — confirmed by reading the
code, not just believing the report. **The real gap**: `ReviewQueueCard
.tsx::resolve()`'s handling of a 410 (the in-memory `MemorySaver`
checkpoint is gone — a server restart since upload, `docs/HANDOFF.md`'s
own known limitation) showed the identical manual "this document can no
longer be reviewed automatically... [Delete]" fallback for *both* confirm
and reject, needing a second click either way. Reject's intent is
unambiguous ("make this gone"), so its 410 path now calls the same
archive endpoint the manual fallback used, automatically — no second
click. Confirm keeps the manual fallback: a correction can't be silently
auto-applied without knowing what was actually being confirmed.
**Verified live with a real forced 410**, not simulated: uploaded a
document through the real UI, restarted the backend process (the exact
condition that produces this — wipes `MemorySaver`'s in-memory state),
then rejected the now-orphaned review item. No fallback prompt appeared;
the normal "rejected and archived, upload a replacement?" banner did;
`document.status` confirmed `archived` directly in the DB afterward.

**(2) Deleted/rejected items never appear on the calendar or any list.**
Confirmed already true, not rebuilt — item 1's own finding already covers
every list this could apply to (`GET /api/documents` feeds Calendar,
Company Files, and Search alike). Verified live: an archived test
document is absent from both Company Files and Calendar.

**(3) "Last upload result" box removed outright** (`UploadPage.tsx`) —
the review queue below genuinely does already communicate a
`needs_review` outcome, exactly as instructed. **A real side effect
flagged plainly, not silently absorbed**: a *quarantined* upload (the
injection-guardrail hard-stop) never creates a `review_item` at all, so
after this change it gets zero inline feedback of any kind — the file
just doesn't appear anywhere, with no explanation shown. Rare (a genuine
injection-quarantine event), but a real regression from this specific
instruction, not a false alarm — `docs/KANBAN.md` Backlog has the
follow-up decision needed (leave as-is, or add back a minimal
quarantine-only notice).

**(4) DD/MM/YYYY dates in the extracted-fields grid.** A real constraint
surfaced and reasoned through *before* writing code, not discovered
after: a native `<input type="date">`'s *displayed* format follows the
browser/OS locale, not application code — HTML5 only guarantees the
underlying stored value is ISO `YYYY-MM-DD`. There is no way to force a
native date input to always visually show DD/MM/YYYY across every
browser/OS. Built a small masked text input instead (`opsShared.tsx`'s
`isoToDmy`/`dmyToIso`) — parses/validates DD/MM/YYYY on the way in, ISO
stored underneath — applied to the two date-shaped extract fields
(`issued_on`, `due_on`; a closed, hand-kept-in-sync set matching
`InvoiceFields`/`StatutoryFields`, `app/models.py`), not every field the
generic grid renders.

**(5) Doc Type's "—" clear pill removed.** Checked first, as asked: does
any workflow depend on clearing `doc_type` back to empty? `doc_type` is
always set by the pipeline before a human ever sees this field, clearing
it produces an empty string with no meaningful effect anywhere
downstream (`derive_expectations.py`'s doc_type matching, the PATCH
endpoint) — a vestigial pill nobody needed. Removed from `DocTypeField`
(`opsShared.tsx`), fixing every caller at once.

**(6) The separate "is this a picture, not a document?" checkbox
removed entirely** (`PictureToggleField` deleted, both call sites in
`ReviewQueueCard.tsx`/`DocumentCard.tsx`) — reasoned through, not just
followed: `DOC_TYPES` already includes `'photo'` as a normal pill option,
so the checkbox was a second control answering the exact question the
pill already did. Picking "Photo" from the Doc Type pills now IS the
correction — `resolve()`/`save()` detect it and send `is_picture: true`
instead of a plain `doc_type` update, triggering the same existing
deterministic server-side lane/doc_type/bucket correction
(`DocumentEditRequest`'s docstring, unchanged) — only what triggers it
moved. Still locks (disabled) once already in memory lane, same
one-directional design as before. The upload-time Document/Photo toggle
(`UploadPage.tsx`) deliberately untouched — at that point nothing has
been classified yet, so there's no Doc Type field to pick from.
**Verified live end to end**, not just typechecked or read: picked Photo
on a seeded review card, saved, confirmed directly in the DB that
`lane='memory', doc_type='photo', bucket='Memory Lane'` — the exact
correction the old checkbox used to produce.

**(7/8) All confidence wording removed from what a user sees.**
`app/graph/verify.py::_check_classify_confidence`'s and
`_low_confidence_fields`'s contributions to `reasons`/`question` are
gone. Reasoned, not just executed: `needs_review` is already
unconditional (DECISIONS #40), so a document whose only issue was low
confidence still gets reviewed exactly the same either way — removing
these only stops the message from naming a raw percentage or specific
field names, it skips no review. `_check_classify_confidence` itself
stays defined (`evals/run.py`'s unreadable-document eval exercises it
directly, independent of `verify()`); `_low_confidence_fields` was
genuinely dead after this and deleted, along with the now-unused call
site. `_check_description_signals_problem` deliberately kept — a content
check on the model's own words, not a numeric score, the same
distinction the report itself drew. The per-field inline confidence
percentage/"(please check)" flag removed from `ReviewQueueCard.tsx`'s
extracted-fields grid too.

**(9) Bottom nav given more vertical room** (`BottomNav.tsx`) — items'
`py-1.5`→`py-2.5`, icon `20`→`22`; the raised center Upload button grown
proportionally (`h-12`/`-mt-5`→`h-14`/`-mt-6`, icon `20`→`22`) so it
doesn't shrink relative to the now-taller bar around it.

**(10a) Field-name translations + a language-name fix.** New
`ops.review.fieldLabel.*` map (`opsShared.tsx::fieldLabel`) translates
every possible extract-result field name (`vendor`, `gst_reg_no`,
`invoice_no`, `issued_on`, `subtotal`, `gst`, `total` from
`InvoiceFields`; `doc_type`, `reference_no`, `due_on`, `subject` from
`StatutoryFields`) instead of printing the raw dict key — the generic
fields grid renders whichever set a document's lane produced, so all 11
needed covering, not just the invoice ones. `i18n.ts`'s Malay option
renamed `"BM"` → `"Malay"`.

**(10b) The largest single piece of this round — `verify()`'s reasons
restructured from pre-joined English sentences to `{code, params}`
dicts.** New `ReviewReason` Pydantic model (`app/models.py`); every
reason-producing check in `app/graph/verify.py` converted — injection-
suspected, extraction-error, zero-amounts, gst/total-mismatch, amounts-
not-in-text, missing-required-fields, missing-arithmetic-fields,
description-signals-problem, file-missing, the clean/no-issues case, and
the hard-quarantine case — the *entire* set, reported as a complete
conversion rather than assumed safe from a partial one. Stored as JSON
in `review_item.question`; the frontend now owns all phrasing via new
`ops.review.reasons.*` i18n keys with interpolation
(`opsShared.tsx::reasonText`), the same pattern `ops.status.*` already
established for status codes. `review_item.reason` (DB column) now holds
a short debug string (reason codes joined, e.g. `"gst_mismatch"`)
instead of the old full sentence — no longer load-bearing for the
frontend: `ReviewQueueCard.tsx`'s `isRoutine`/`isFileMissing` now derive
from the parsed `question` array's shape (empty / a lone `file_missing`
entry) instead of exact-matching a stored string. Touched:
`app/models.py`, `app/graph/verify.py`, `app/graph/human_review.py`
(interrupt payload, unused downstream — confirmed via grep — so a free
rename), ~10 `tests/test_rules_smoke.py` assertions rewritten to check
`code`/`params` instead of substring-matching sentences (one test's
whole premise — low-classify-confidence alone triggering a reason — was
intentionally flipped to assert the new "falls through to clean"
behavior, per 7/8's own stated reasoning, not left contradicting the
code), `opsApi.ts`'s `VerifyResult`/`ReviewItem` TypeScript types.

**(11) Existing amber/red warning styling kept exactly as-is**, per
explicit instruction — just wired through the new i18n-driven text
instead of a raw stored string.

**Verified live end to end** (Playwright, 375px, EN and Malay, a
manufactured GST-mismatch review card plus a real forced-410 reject):
the full flagged-card sentence renders correctly in both languages with
real interpolated numbers ("Please confirm: GST 84.00 is not ~9% of
subtotal 300.00 (expected ~27.00)" / "Sila sahkan: GST 84.00 bukan ~9%
daripada subjumlah 300.00 (dijangka ~27.00)"); field labels translated in
both languages; the DD/MM/YYYY date field renders `15/09/2026` from a
stored `2026-09-15`; no raw codes, percentages, or confidence wording
found anywhere in the rendered card text in either language; the
doc-type clear pill and the separate picture checkbox both confirmed
absent from the DOM. `pytest tests/` 47/47, `python evals/run.py` 14/14
adversarial, `npm run typecheck`/`npm run build` clean. The two
manufactured test documents used for live verification were cleaned up
via the real archive endpoint afterward, not left sitting in the shared
dev DB. Screenshots (375px, EN + Malay):
`docs/screenshots/round6-review-card-gst-en-cropped.png`,
`round6-review-card-gst-ms-cropped.png`, `round6-bottomnav-en.png`,
`round6-bottomnav-ms.png`, `round6-reject410-after.png`,
`round6-company-files-no-archived.png`, `round6-item6-photo-picked.png`.

**Follow-up: quarantined uploads get real feedback in the Needs Review
queue — and a genuinely different, more correct fix than what was
proposed was needed to make Reject actually work on one, found by
verifying the proposal live instead of trusting the read (2026-09-23,
DECISIONS #68).** Decided design, given up front: no separate "notice"
concept — a blocked file lands in the exact same queue as everything
else, plain language, no "quarantine"/"confidence"/"admin" jargon.

**(1) `verify()`'s hard-quarantine branch now inserts a `review_item`**
— it used to `return` before ever reaching the bottom-of-function INSERT
(confirmed by reading the full function), exactly why a quarantined
upload vanished with zero feedback (DECISIONS #67's own flagged gap).
Reuses the existing INSERT, not new plumbing; `proposed_json` is
deliberately `"{}"`, not the real `extract_result` — a document flagged
for injected instructions shouldn't have its extracted field values
presented as trustworthy to accept, on top of Accept not even being
offered for this reason (see #4). New code `injection_suspected_blocked`
(distinct from the existing soft `injection_suspected`, which stays
reviewable with Accept available).

**(2) A real, more serious bug found by verifying the proposed mechanism
live, not assumed from the read.** The proposal: reuse DECISIONS #67's
reject-on-410 auto-archive fallback — "this document's pipeline never
reaches human_review, so there's no checkpoint to resume, ever, so it'll
410 like an expired session." Reproduced against the actual running dev
server and found this is **not reliably true**: LangGraph still
checkpoints after `verify()` runs even on this early-return path — it's
just a checkpoint reflecting an already-*completed* run with nothing
pending. Resuming *that* via `Command(resume=...)` succeeds as a silent
no-op (a real HTTP 200, `document.status` and `review_item.status` both
left completely untouched) rather than raising `InvalidUpdateError`/410,
unlike a genuinely-restarted session's fully-absent checkpoint (confirmed
both ways against the live server). The original plan's Reject button
would have shown a false "rejected and archived" success message while
silently leaving the card stuck in the queue forever — worse than doing
nothing, and confirmed live before shipping it. **Real fix**:
`app/main.py::resolve_review` now checks `document.status == 'quarantined'`
before ever touching the pipeline, and if so, archives directly
(`transition_document(..., "archived", ...)` + dismiss the review_item)
— the same effect `POST /api/documents/{id}/archive` already has, reached
from the endpoint the UI already calls, bypassing the unreliable pipeline
resume entirely for this case.

**(3) `_check_classify_confidence` reconnected to `verify()`'s reasons**
— DECISIONS #67 (items 7/8) had deliberately disconnected this,
reasoning that `needs_review` is already unconditional so nothing was
skipped; the uncaught side effect was that an unreadable document then
produced *zero* reasons and fell through to "No issues found," actively
misleading for a document nobody could actually read. Reconnected with a
new code (`could_not_read_document`, renamed from
`low_confidence_classification` now that it's user-facing again) and
empty params — the percentage is genuinely gone from the data, not just
hidden by the frontend. `_check_description_signals_problem` untouched
(already correctly scoped as a content check, not a numeric score).

**(4) Accept hidden for the blocked case** (`ReviewQueueCard.tsx`'s
`isInjectionBlocked`, `opsShared.tsx::isInjectionBlockedReason`) —
nothing was ever presented as trustworthy to confirm; only Reject shows,
and it now genuinely removes the card (see #2).

**(5) Confirmed live, not assumed**: the "Extracted fields" section
already correctly stays hidden for both cases (gated on
`fieldNames.length > 0`, naturally empty since `proposed_json` is `"{}"`
for the blocked case and lane='memory' never populates it for the
unreadable case); the "Document" fields section (filename/description/
bucket/doc_type/vendor_name) correctly still renders for both — classify()
already ran and set these before verify() ever sees the document, for
both cases. `reasonText()` (`opsShared.tsx`) also special-cased
`injectionSuspectedBlocked` the same way `file_missing` already was — its
translated sentence is a complete, standalone statement ("...Delete it,
or upload a different copy."), not a fragment meant to follow "Please
confirm:" (caught live: the wrapped version read as nonsensical, nothing
was being confirmed). New `ops.review.reasons.injectionSuspectedBlocked`/
`couldNotReadDocument` i18n keys in all 4 locales.

New regression test
(`tests/test_auth.py::test_resolve_review_archives_a_quarantined_document_without_touching_the_pipeline`)
— seeds a quarantined document directly (gateway-free) and asserts the
real HTTP resolve call archives it without ever needing a real pipeline
checkpoint, proving the fix works regardless of process/checkpoint state,
not just in the one live repro.

Verified live end to end (Playwright, 375px, EN + Malay): a real
regex-triggered quarantine attempt via the actual upload endpoint hit a
**separate, pre-existing, out-of-scope crash** in
`app/extract/extract.py` (`llm_result.tool_calls[0]` —
`TypeError: 'NoneType' object is not subscriptable`, the model
apparently sometimes returns no tool call for adversarial invoice-shaped
text) — not fixed here, flagged in `docs/KANBAN.md`'s Backlog instead;
live verification of the review-queue behavior itself used a
directly-seeded quarantined document instead (same `resolve_review` code
path regardless of how the review_item was created), while the
unreadable-document case was verified via a real upload end to end (no
gateway call needed for that path — classify.py's own no-OCR-text
fallback is deterministic). Confirmed: no Accept button, no Extracted
fields section, plain-language reason with zero "quarantine"/
"confidence"/"admin" wording in either language, clicking Reject actually
removes the card and archives the document (`document.status`/
`review_item.status` confirmed in the DB), the unreadable case keeps
Accept and shows the new plain reason instead of a misleading "No issues
found." `pytest tests/` 48/48 (1 new test), `python evals/run.py` 14/14
adversarial, `npm run typecheck`/`npm run build` clean. Screenshots
(375px, EN + Malay): `docs/screenshots/round7-quarantine-headline-buttons-en.png`,
`round7-quarantine-headline-buttons-ms.png`,
`round7-unreadable-card-en.png`, `round7-unreadable-card-ms.png`.

**Fixed the extract.py/classify.py 500-on-zero-tool-calls bug DECISIONS
#68 found and flagged, plus a second, unrelated bug it surfaced —
committed and pushed this round, explicitly authorized without a
separate go-ahead (DECISIONS #69, 2026-09-24).** Both
`app/graph/extract.py` and `app/graph/classify.py` indexed
`llm_result.tool_calls[0]` unconditionally, before their own existing
`except ValidationError` graceful fallback ever got a chance to run — a
raw `TypeError` (500) on the model returning zero tool calls despite
`tool_choice` forcing one. Fixed with a one-line guard in each
(`args = {}` when `tool_calls` is empty), reusing the existing fallback
rather than adding a new one — `model_cls(**{})`/`ClassifyResult(**{})`
fails required-field validation the same way a real schema mismatch
already does. Same pattern `app/graph/derive_events.py`'s identical call
site already had. **A second, more serious, entirely separate bug found
while writing the regression test for this fix** — the one that actually
exercises the except-block path for the first time: `extract.py`'s own
schema-mismatch trace `INSERT` had 10 `?` placeholders (including `node`)
but only 9 bound values, so it raised `sqlite3.ProgrammingError` every
time it ran — **the fallback path specifically built to turn a schema
mismatch into a review item instead of a 500 has itself always 500'd**,
silently, since the fix that introduced it (2026-09-22). Fixed the same
way `classify.py`'s identical trace insert already correctly does it
(`node` as a SQL literal, not a 10th bound placeholder). Two new
regression tests (`tests/test_rules_smoke.py`, mocking `call()` to return
zero tool calls — no gateway needed). `pytest tests/` 50/50,
`python evals/run.py` 14/14 adversarial. No UI touched, no screenshots.
`./scripts/prepush-check.sh` FAILs verified as pre-existing, unrelated
local-machine artifacts (`.env`/`web/.env`/`.vercel/` present on disk —
confirmed gitignored and never git-tracked via `git check-ignore -v` and
`git ls-files`; a Vercel URL in `app/main.py`'s existing CORS allowlist)
— not a reason to hold back this push. **Lightsail was deliberately NOT
redeployed** — a standing project rule holds regardless of this round's
own explicit authorization to push freely: redeploying always needs the
user's own explicit ask, not a relayed one (see "GitHub" bullet above).

**Round 9 (10-item batch) implemented — items 1, 2, 3, 5, 6, 7, 9, 10 built and
verified; items 4, 8 assessed only (DECISIONS #70/#71). **Committed and pushed as
`1c43ffe` by someone other than the session that built it, between rounds
(`git log origin/main` and `git status -sb` confirm `main` is in sync with
`origin/main`); not redeployed to Lightsail as far as this session can
verify (DECISIONS #72, 2026-09-24).** Ordered as instructed: correctness bugs first, then features,
then assessment docs. **Item 2 (company-local dates):** root cause was
`derive_obligations.py`'s `date.today()` reading the server clock, not the
company's own timezone (storage itself was already correct UTC — not the
bug). Fixed with a new `company.timezone` column (IANA name, default
`Asia/Singapore`, wired into `PATCH /api/companies/{id}` with `zoneinfo`
validation) and `zoneinfo`-based "today" everywhere it's derived, backend
(`derive_obligations.py`) and frontend (`lib/dates.ts`'s
`dayInTimezone`/`todayInTimezone`, `Intl.DateTimeFormat('en-CA', {timeZone})`
— used by `MonthGrid`/`DatesView` instead of the browser's own local time).
New test reproduces the bug on the old code (near-midnight mocked clock,
wrong UTC-naive date) and passes after the fix. **Items 9/10 (currency +
locality-aware tax) — a real schema gap, not just a verification task:**
`InvoiceFields` gained `currency: Provenance[str | None]` (didn't exist at
all before) and `tax`/`tax_label` (renamed/generalized from a SG-only `gst`
field). `verify.py`'s 9% arithmetic check is now gated on **both** the
company's own locality (piggybacked on item 2's `timezone` column) **and**
the invoice's own extracted currency — locality alone would not have fixed
the bug's own worked example (an SG company receiving a genuine foreign
invoice). Verified live: a real SGD invoice and a real synthetic IDR/PPN-11%
invoice through the actual gateway, both captured correctly, the IDR one no
longer false-flagged against the SG rate. Sized honestly, per the batch's
own request: this is a real migration (extraction schema, `verify.py`,
`evals/run.py`, every frontend site keyed on the old `gst` field name), not
a quick rename. **Items 5/6 (selected language reaches the LLM; bilingual
description storage + search):** frontend sends `i18n.language` on upload
(same shape as the existing `is_picture` param); `classify.py`'s prompt
generates `description` in that language and `description_en` in English
always, with an explicit instruction that extracted field values are never
translated, only descriptive prose. `document.description` is now
JSON-encoded (`{"en": ..., "<lang>": ...}`), backward-compatible with every
pre-existing plain-text row (`parse_description`/`description_for`,
`app/db.py`); both languages feed the existing FTS5 index. **Two real live
bugs found and fixed, neither caught by tests that called a graph node
directly rather than the real pipeline:** `PipelineState` never declared a
`language` key — LangGraph derives its accepted state schema from the
TypedDict's own declared keys and silently drops anything undeclared, so the
language never reached `classify()` despite the frontend sending it
correctly; found via a live Playwright upload, fixed by declaring the key,
and the new regression test goes through the real `PIPELINE.invoke()`
specifically because calling `classify()` directly wouldn't have caught
this. `ReviewQueueCard.tsx`'s description-resync guard
(`current === '' ? fresh : current`, DECISIONS #56) froze the field at
mount-time language once any description existed — fixed with a
`descriptionEditedRef` dirty-tracking flag; a related staleness bug in
`DocumentCard.tsx` (Edit button not re-syncing before entering edit mode)
fixed alongside it. **Item 1 (upload success toast):** new
`components/ui/Toast.tsx` (`useToast()` hook, 4s auto-dismiss, non-blocking,
`role="status"`/`aria-live="polite"`), wired into `UploadPage.tsx`, i18n'd
from the start. Verified live in EN and MS, auto-dismiss timing confirmed.
**Item 7 (lifecycle audit):** confirmed round 6/7's temp-file cleanup still
holds; confirmed zero orphaned `document`/`review_item` rows on the real dev
DB. Two real gaps found and fixed: `session` rows were never purged, only
checked at auth time (`app/auth.py::issue_session` now deletes
expired/revoked rows on every new login); `JAGA_DOCS_PATH` was declared in
`.env.example` since day one but never actually read (`app/graph/ingest.py`
hardcoded `./data/docs`) — now reads it. **Item 3 (portability audit,
`docs/PORTABILITY.md`):** what runs where today, what's config-portable vs.
what this round moved behind env vars (`LLM_MODEL_NAME`,
`CORS_ALLOWED_ORIGINS`), the gateway's own tool-call quirks named as a real
vendor dependency (GAPS.md §11), SQLite recorded as a deliberate choice with
a named Postgres migration path (JSON column → `jsonb`, FTS5 →
`tsvector`+GIN, swap point is `app/db.py`'s own functions). **Items 4/8
(multi-company/group tenancy + its UI, DECISIONS #70/#71) — assessed only,
nothing built:** the real single-company collapse found in
`app/auth.py::_membership_from_token`'s `ORDER BY id LIMIT 1`; capacity
numbers verified against actual code — the unpaginated `GET /api/documents`,
not FTS5, is the real first bottleneck; a company-switcher recommendation
(not the peer's cross-company filter-chip instinct) as the smallest real
version. **Checks:** `pytest tests/` 54/54, `python evals/run.py` 14/14
adversarial, `npm run typecheck` and `npm run build` both clean.
Screenshots: `docs/screenshots/round9-toast-{en,ms}.png`,
`round9-invoice-review-{en,ms}.png`, `round9-resync-fixed-ms.png`,
`round9-ms-native-description.png`. `./scripts/prepush-check.sh` was not run by the
building session —
nothing is being pushed this round. Full per-item detail:
`docs/KANBAN.md` Done (2026-09-24), `docs/DECISIONS.md` #70-#72.

**Round 10 (5-item follow-up on round 9's language work + one cosmetic) —
built and verified; committed and pushed as `304c49e` by someone other than the
building session (DECISIONS #73, 2026-09-24).** Two of the request's premises did not survive checking against
the running app, and the docs record what was actually found. **Generation
(item 1):** verified independently, not re-investigated — a real upload with
`language=ms` stored `{"en": ..., "ms": ...}` with a native Malay sentence;
locked in by 3 new gateway-free upload-level tests (`tests/test_upload_
language.py`, mutation-checked against both the `main.py` handoff and the
`PipelineState` declaration). **Display (items 2/3):** the request said
Company Files' card doesn't react to a language switch — live baseline showed
the card *face* already did (it is derived from `descriptionFor(doc.
description, i18n.language)` on every render, not from state); what actually
stayed stale was the open *edit form's* input. Fixed by extracting
ReviewQueueCard's own ref+effect into one shared hook,
`useEditableDescription`, and using it in both cards (a copy would have
re-created the drift that already produced a bug in round 9); one deliberate
deviation from a straight port — `DocumentCard` outlives save/cancel, so it
also calls `resetDescription()` on entering edit mode. Frontend regression
tests: this project's first test runner (vitest + jsdom + Testing Library,
`npm run test`, 8 tests, mutation-checked). **Photo path (item 4):** root
cause confirmed and reproduced live (a real temple photo, non-picture path:
"Document with unclear or corrupted text") — the prompt's own example
("Photo of a document, text unclear") presupposed a document. Reworded, and
the model is now told it only sees OCR text, must not guess what a picture
shows, and must use one fixed English phrase plus confidence ≤ 0.3. **The
"connect it to could_not_read_document" half was already true** (both the
low-confidence and the problem-word signals fired before any change), but
the suggested reword would have silently switched the word signal off, so
the phrase now lives once in `classify.py` (`UNREADABLE_EXAMPLE_EN`) and is
imported by `verify.py`'s detector. Live after: temple photo → "Image with no
clear readable text" plus both reasons; a Malay upload → English + a real
Malay sentence plus both reasons. **Never both languages at once (item 5):**
true by construction (`descriptionFor` returns one string); now also a test.
**Cosmetic (docType-locked helper text):** not reproduced — measured the
text's geometry at 375px and 320px, all four languages, both places it
renders: it wraps (1-2 lines), stays in the viewport, no clipping ancestor;
no change made. **Checks:** `pytest tests/` 59/59, `python evals/run.py`
14/14, `npm run test` 8/8, `npm run typecheck` and `npm run build` clean.
Screenshots: `docs/screenshots/round10-*.png`.

**Round 11 (11-item batch) — items 6, 7, 9, 10 built and verified; items 1-5 and
the cosmetic confirmed, not rebuilt; items 8 and 11 assessed only. Uncommitted,
awaiting a go-ahead (DECISIONS #74, #75, `docs/PERMISSIONS.md`, 2026-09-24).**
**Confirmations (1-5):** the round-9/10 tests (`tests/test_upload_language.py`,
`DocumentCard.i18n.test.tsx`) still pass and were not duplicated; the classify
prompt was re-verified live after this round edited it (a real temple photo still
reads "Image with no clear readable text", both signals fire). **Item 6:** a
Malay/Chinese/Tamil review card no longer carries English fragments — chose
option (a), dropping the interpolated matched word; the same bug class was wider
than named (extract.py's raw pydantic error in `extractionError`), so that was
dropped too, and `missingRequiredFields`' field names now go through
`fieldLabel`. Also found: three messages still said "GST" after round 9's
gst-to-tax rename — now "tax". **Item 7:** display-layer only — two signals for
one problem show once, distinct reasons stack as a list (`reasonDisplay()` +
`ReviewReasons`); the backend still emits both signals. **Item 9:** user1/user2
seeded; the ownership rule is one function, `auth.may_edit_document`, shared by
the PATCH check and a new per-caller `can_edit` on list/search, so the UI hides
Edit where the server would refuse; 26 tests with real uploads and logins,
mutation-checked, plus a live HTTP matrix and a UI check at 375px for each role.
No user-vs-user hole was found. **Item 10:** Contracts bucket — the request named
two places, but `BucketName` in `app/models.py` also validates edits and classify
output (without it, edits 422); the prompt list is now derived from it and
`tests/test_buckets.py` guards the frontend/backend copies; a routing rule
(lease/contract to Contracts) was needed for the bucket to ever be chosen and is
flagged as a product call. **Items 8/11 (assessment):** `docs/PERMISSIONS.md` — the
matrix re-verified live, and **`GET /api/companies` found readable by an anonymous
caller (all 23 companies)**; DECISIONS #75 — multi-image upload, where the
request's two premises were wrong: an image-only PDF already 500s today (and
orphans a file), and rasterizing PDF pages needs no new dependency (pypdfium2 ships
with pdfplumber). Parked, not built. **Checks:** `pytest tests/` 88/88,
`python evals/run.py` 14/14, `npm run test` 23/23, `npm run typecheck` and
`npm run build` clean. Screenshots: `docs/screenshots/round11-*.png`.

**Urgent pair (outside the batch), 2026-09-24 — committed and pushed, NOT
redeployed (DECISIONS #76).** Deleted the two unauthenticated company
handlers (`GET`/`POST /api/companies`: anonymous callers got every company's
name, UEN, FYE and GST flag; nothing called them, re-confirmed by grep) — the
same no-header curl now returns 404, and a new test requires HTTP 401 with no
credentials for every registered route except `/api/health` and
`/api/auth/dev-login`. Fixed image-only (scanned) PDF uploads, which returned
HTTP 500 and left an orphaned file: `app/extract/ocr.py::extract_pdf_text`
rasterizes pages with pdfplumber (pypdfium2 is already installed), 200 dpi,
10-page cap; `app/graph/ingest.py` now extracts text before copying into
storage and removes a copy it created if the insert fails. Verified live with
the real gateway on a 2-page scanned invoice (HTTP 200, OCR text from both
pages, all fields extracted, exactly one stored file matching its row); a
genuinely broken PDF still 500s but leaves 0 files. Multi-page decision recorded
(inline mobile preview loss accepted; first-page thumbnail if cheap). Also fixed
a #74 regression under deploy skew: against a backend without `can_edit`, Edit
vanished for every role — now only an explicit `false` hides it. `pytest tests/`
113/113, `python evals/run.py` 14/14, `npm run test` 26/26, typecheck/build clean.
**Not deployed: the leak is still open on the live box until the backend is
redeployed, which needs the user's own explicit ask.**

**Known gaps, in the order they'll bite:**
- **⚠ Lightsail needs a redeploy to pick up rounds 9, 10 and 11 as well as DECISIONS #69's fix** (2026-09-24) — rounds 9 and 10 are committed and pushed (`1c43ffe`, `304c49e`), round 11 is not yet; none is redeployed as far as this session can verify. Original round-9 note: — company-timezone dates, bilingual descriptions, session-purge, currency/locality-aware tax all live only in this checkout; round 9 is committed and pushed (`1c43ffe`) but, as far as this session can verify, not redeployed to the box (DECISIONS #72); round 10's changes (DECISIONS #73) are still uncommitted. The extract.py/classify.py 500-on-zero-tool-calls bug and the schema-mismatch trace-insert crash from DECISIONS #69 are separately already pushed but still await their own redeploy. Redeploy needs the user's own explicit go-ahead, not a peer's, per this project's standing rule.
- **⚠⚠ The anonymous company-list leak is FIXED IN THE REPO but STILL LIVE on the deployed box** (2026-09-24, DECISIONS #76) — `GET`/`POST /api/companies` were deleted (nothing called them); until the Lightsail backend is redeployed, the internet-reachable server still returns every tenant's company list to anyone. Redeploy needs the user's own explicit ask. Check with `curl -s -o /dev/null -w '%{http_code}' https://13-251-52-222.nip.io/api/companies` (200 = still leaking, 404 = fixed).
- **Scanned-PDF upload is fixed in the repo, not yet on the box** (2026-09-24, DECISIONS #76) — image-only PDFs are rasterized (pdfplumber, 200 dpi, 10-page cap) and OCR'd instead of raising; `ingest` extracts before copying so a failure leaves no orphaned file. Still open: a corrupt PDF/image returns 500; later pages of a long scan are dropped; OCR blocks the event loop; orphans already on the box are not cleaned up.
- **Sparse OCR noise on a non-document photo still reaches the LLM** (round 10, DECISIONS #73) — `app/graph/ingest.py` treats image OCR under 10 characters as "no text" (deterministic, no LLM call, "Untitled photo"), but four real non-document photos measured 3, 5, 5 and 17 alphanumeric characters: the 17-character one still went to the model. The new prompt handles it honestly and both review reasons fire, so this is a consistency/cost option (raise the threshold, count alphanumerics), not a bug — at the price of false alarms on genuinely tiny text images. Not changed.
- **The unreadable-image review reason quotes the English detector phrase inside a translated sentence** (round 10) — `description_signals_problem`'s `{{word}}` is the matched English phrase, shown as-is in the zh/ms/ta sentence (visible in `docs/screenshots/round10-locked-text-review-ta.png`). Pre-existing for every matched word; more visible now that the phrase is longer. Redundant with the plain "we couldn't read this file" reason shown beside it.
- **`GET /api/documents` is genuinely unpaginated** (confirmed by grep, DECISIONS #70) — returns every non-archived row for the company on every call; `useOpsData.ts` already refetches on every route navigation by design. Verified this, not FTS5 search, is the first real bottleneck as a company's own document history grows. No urgency at today's real row counts.
- **`_check_amounts_in_text`/`_amount_strings()` (`app/graph/verify.py`) doesn't handle thousands-separator-formatted numbers** — found 2026-09-24 testing a synthetic IDR invoice with comma-formatted amounts, which falsely tripped `amounts_not_in_text`. Not fixed; more likely to matter now that item 9/10 actually enables large non-SGD amounts.
- **~500+ leftover `tmp*.pdf`/`tmp*.db` files accumulate in the OS temp dir** from `tests/test_rules_smoke.py`'s `_seed_company_and_document` helper's `tempfile.mktemp()` pattern (found during item 7's lifecycle audit). Test-only, harmless, not fixed — would need touching dozens of call sites.
- **Golden-path eval cases (`evals/cases/golden/`) remain blocked on real data** (2026-09-23, DECISIONS #66) — this session has no access to real labelled invoices/documents, and the project's own privacy policy (`WINNING.md`) deliberately keeps real corporate documents out of the repo. Needs the user to supply specific files or explicitly waive that policy.
- **Golden-path eval cases (`evals/cases/golden/`) remain blocked on real data** (2026-09-23, DECISIONS #66) — this session has no access to real labelled invoices/documents, and the project's own privacy policy (`WINNING.md`) deliberately keeps real corporate documents out of the repo. Needs the user to supply specific files or explicitly waive that policy.
- **Whether items 1/2/6's original live symptom ("file missing" + "no issues found" together, vanishing photos) is actually resolved is unconfirmed from this session** (2026-09-23, DECISIONS #66) — most plausibly it already was, by the reporting session's own Lightsail deploy fix; the new `_check_file_exists` guardrail is real defense-in-depth regardless, verified only via a unit test, not against the live box.
- **The EXIF-rotation fix's real-world impact on the *specific* live-mobile regression that prompted it is unconfirmed** — verified with a synthetic test image + a real gateway call, not the original reported photo. The frontend should already prevent pure-rotation cases for a real web upload (`imageNormalize.ts`'s own docstring); if the symptom persists after this deploys, the already-tracked deskew/crop/quality gap (below) is the more likely cause, not rotation.
- Server-side OCR preprocessing beyond EXIF-rotation (`app/extract/ocr.py` still does no deskew/crop/contrast correction) — a photo taken at an angle, not a discrete 90°/180°/270° rotation, is still unaddressed; narrowed, not closed, by DECISIONS #65.
- **The banner's classify-confidence line ("classified as X/Y, N% confident") has silently never rendered since DECISIONS #40** — found 2026-09-22 while verifying the fix above. `upload_document`'s two live return branches don't include a `classify` key; only the removed "processed" branch ever did. `docs/KANBAN.md` Backlog has the fix.
- **The hallucination guard (DECISIONS #48) only catches values absent from the text entirely** — a wrong-but-present value (or a fabricated number that happens to substring-match something else in the document) isn't caught. Stated as a known limitation in DECISIONS #48, not a bug to silently work around.
- `evals/cases/golden/` is empty — needs ~15 labelled real documents (see `evals/cases/golden/README.md`)
- `app/rules/expectations.py`'s expected-document-set is a small starter list, **not** the team's real "19 documents, 14 held" checklist — that external data needs to be loaded in before the gap-analysis demo means anything
- No scheduler (`APScheduler`), no Telegram bot — "the clock" (the actual agent, per `MOAT.md`'s one-liner) doesn't exist yet. Explicitly deprioritized 2026-09-22 (DECISIONS #28), not a gap to close right now.
- `LangGraph` checkpointer is `MemorySaver` — a pending human review is still lost on server restart (fine for a demo, not for the deployed box without a swap to a durable checkpointer); as of 2026-09-22 this is no longer a dead end when it happens — the review card offers Archive instead of failing forever — but the underlying loss is unchanged
- `app/rules/statutory.py`'s Form C-S/C due date (30 Nov) is a working approximation, flagged in its own docstring — confirm before citing a specific date in `docs/WRITEUP.md`
- `app/llm.py`'s per-token pricing is Anthropic list pricing, not confirmed as the gateway's actual billed rate
- **`document.sha256` is UNIQUE globally, not per-company** — found live 2026-09-22 seeding a second test company; a byte-identical file can never be uploaded to two different companies. `docs/KANBAN.md` backlog; needs a table rebuild in SQLite, not a one-line fix.
- **`jaga-vision`'s `MemoryMax=2.5G` cap (DECISIONS #55, #58) is unverified — genuinely untestable on macOS (no systemd/cgroups), not just untested.** The whole "isolated service can't take down the box" design depends on this actually firing. `deploy/README.md` has the exact live-box verification procedure. **`jaga-vision` is deployed and generating correct captions as of 2026-09-23** (DECISIONS #56 — confirmed live, not the same thing as this cap being confirmed) — deployment happening doesn't by itself confirm `MemoryMax` fires; that must still be checked before trusting the isolation in front of anyone. **DECISIONS #58 revised what the cap needs to cover** (a real measured ~390MB resident baseline, not the ~2GB #55 assumed) but the code change itself hasn't reached the box yet — see the entry above.
- **`vision/app.py`'s resident-model change (DECISIONS #58) has not been deployed to the live Lightsail box** — the code is committed locally but `jaga-vision` on the box is still running the old per-request-load version until it's deployed and restarted, which needs an explicit go-ahead first (same box, same rule as the original DECISIONS #55 build). Until then, the box's captions still pay the ~20s load cost on every single request, not just the first after a restart.
- **Some UI strings in `zh.json`/`ms.json`/`ta.json` were translated by the assistant, not a human** — DECISIONS #62's four (`header.accountMenu`, `ops.dates.prevMonth`/`nextMonth`/`selectADay`/`noneOnDay`) plus DECISIONS #63's longer list (`ops.bucket.*`, `ops.docType.*` beyond the original `legacySuffix`, `ops.role.*`, `ops.risk.*`, `app.notFound.*`). Everything else in those three files is a real, human-provided translation (DECISIONS #61, supersedes #57's English-value stubs) — just not these yet. `docs/KANBAN.md` Backlog has the follow-up.
- **`DocumentCard.tsx`'s header fallback shows raw `doc.lane` untranslated** (found during DECISIONS #63's i18n audit, not fixed) — no existing key infrastructure for that vocabulary; low priority, it's only the last-resort label when both `description` and `doc_type` are empty.

## Auth (added 2026-09-22, DECISIONS #28-31)

Every data endpoint requires a session and derives `company_id` from the
caller's membership — never from a client-supplied parameter (closes a
real tenant-isolation gap; every endpoint previously trusted whatever
`company_id` the client sent). 4 roles, numeric order in `app/auth.py`:
`viewer < user < admin < owner`. Permissions: viewer reads; user also
uploads and edits their own uploads (**own-upload check added
2026-09-23, DECISIONS #64** — `user` can't edit another user's upload;
admin/owner can edit any); admin also resolves reviews, archives
documents, and adds members; owner also manages the company (**new
2026-09-23**: `PATCH /api/companies/{id}`, name/FYE only). Full
role × action matrix: `docs/PERMISSIONS.md`. This is a **simpler, generic
set than `PLATFORM.md`'s original six** (owner/director/staff/accountant/
corpsec/auditor) — a deliberate supersession (DECISIONS #29), not an
oversight. **Resolved 2026-09-22**: corp sec maps to `viewer` (sees
everything, changes nothing — already what the role does, no new name
needed); **one `owner` per company, many `admin`s**, enforced in
`add_member` (`app/main.py`), not just documented — adding a second owner
is a 409.

**Login is a placeholder, the session model isn't.** `POST
/api/auth/dev-login` (email in, session out) exists because no
email-sending is set up — real magic-link email (`PLATFORM.md`'s original
design) would swap only that endpoint's internals, not the session/role
model downstream. **This means anyone who knows/guesses an email can log in
as it right now** — fine for today's local-Mac-only demo, a real problem
the moment this backend is reachable from the internet (Lightsail). See
`app/auth.py`'s module docstring and DECISIONS #30.

Schema: `app_user`, `membership` (`company_id`, `user_id`, `role`),
`session` (hashed tokens, 7-day TTL). `document.uploaded_by_user_id`
attributes uploads and, since 2026-09-23, is actually enforced (not just
recorded) for `user`-role edits. Endpoints: `POST /api/auth/dev-login`,
`GET /api/auth/me`, `POST /api/auth/logout`, `GET`/`POST
/api/companies/{id}/members`, `PATCH /api/companies/{id}` (owner-only,
new 2026-09-23). Tests: `tests/test_auth.py` (17 tests, part of the full
41-test suite, no gateway key needed — pure DB/HTTP against
`TestClient`).

Frontend: `web/src/features/auth/` (`AuthContext`/`useAuth` — gained
`refreshCompany()` 2026-09-23 so a settings save reflects app-wide without
a reload, `authApi.ts` for session storage + the auth calls),
`web/src/pages/LoginPage.tsx`. The real app's six pages (`/upload`,
`/company-files`, `/search`, `/company-settings` — new, owner/admin-only,
2026-09-23 — plus the signed-in `/calendar`/`/tags`, DECISIONS #59) are
session-scoped and role-aware via the shared `RequireSession`/`useAuth` —
upload hidden below `user`, review Accept/Reject hidden below `admin`,
editing another user's upload blocked for `user` role, Company Settings
nav entry hidden below `admin` and its fields disabled below `owner` —
instead of a company create/switch UI. `web/src/lib/apiClient.ts`
is the one shared fetch wrapper both `authApi.ts` and `opsApi.ts` use (was
two separate copies before 2026-09-22; also where FastAPI's `{"detail":
...}` error bodies get turned into a plain message instead of showing raw
JSON in the UI).

## Environments

- **UAT:** Vercel project `jagaos` (scope `fresfrida`), behind Vercel login. Frontend only, now calling the live Lightsail backend cross-origin (see below).
- **Production:** AWS Lightsail per GAPS §5. **Live since 2026-09-22** (DECISIONS #32): instance `jaga`, static IP `13.251.52.222`, `https://13-251-52-222.nip.io` (nip.io wildcard DNS, real Let's Encrypt cert, no purchased domain yet). Backend only — the frontend still runs from Vercel and calls this URL cross-origin (CORS already allowed `jagaos.vercel.app`); same-origin serving of `web/dist` from the box itself is still on the backlog.
- Vercel's "production" target (`--prod`) is only how UAT is published. The Vercel site is UAT, not production.

## Architecture (intended)

One AWS Lightsail instance (Ubuntu 24.04, `ap-southeast-1a`). Allowed AWS usage: Lightsail + JSON calls to Bedrock Claude Sonnet 4.5 only (GAPS §5). SQLite + local disk. Python backend (FastAPI). Vite/React static build served by the reverse proxy. Supabase is **not** used (see DECISIONS.md).

## Data flow

- **Implemented (web/):** routing: real URL paths (`/`, `/calendar`, `/tags`, `/how-it-works`, `/stack`, `/get-started`), no `#` routes. `Link` intercepts clicks and calls `navigate` (History API); `useRoute` listens to `popstate` and parses the path; `pages/Page.tsx` maps a route to a page; `useRouteEffects` sets the title, scrolls to top and focuses `<main>`. Direct hits need an SPA fallback to `index.html` (Vite dev/preview: built in; Caddy: catch-all `handle`; Vercel: `web/vercel.json`). Logged-out preview search (deliberately still mock, 2026-09-22 — see DECISIONS #41): `MemorySearch` → `useMemorySearch` → `searchService` (mock, 450 ms latency) → `filterMemories` over `MEMORIES`. Tag list and calendar detail panel read the same mock data through the same helper — this mock model is untouched by the real bucket rework below. **Real search/metadata (2026-09-22, DECISIONS #41-42):** `/ops`'s Documents tab → `opsApi.search`/`editDocument` → `GET/PATCH /api/documents`, `/api/search` → SQLite FTS5 (`document_search`, `app/db.py`, indexed on filename/doc_type/description/extracted_text/bucket/vendor_name) — a separate, authenticated path from the mock preview above, not a replacement of it. `GET /api/tags` no longer exists (DECISIONS #42) — bucket is a fixed frontend constant, not a fetched list.
- **Documented, not built:** upload/Telegram ingestion (`ARCHITECTURE.md` §3's original plan). FTS5 search itself is now built (previous bullet). **"Validation (Jev)" never happened and isn't needed** — confirmed 2026-09-22 (DECISIONS #46) that `Jev`/`langchain-typesafe` has zero references anywhere in this codebase; the actual validation step is `app/graph/verify.py`'s deterministic tax-arithmetic and confidence-floor checks, which has been built and tested since the original backend skeleton (2026-09-21) — a different, real implementation of the same job, not a gap.
- **Company-local "today", not the server clock (2026-09-24, item 2):** `app/graph/derive_obligations.py` derives due dates off `datetime.now(ZoneInfo(company.timezone)).date()`, and the frontend's Calendar (`MonthGrid`/`DatesView`) buckets days and highlights "today" the same way (`lib/dates.ts`), both reading the company's own `timezone` column, not the browser's or the server box's own local time.
- **Selected language reaches the LLM; descriptions stored bilingually (2026-09-24, items 5/6):** the uploader's `i18n.language` flows through `PipelineState` into `classify.py`'s prompt, which writes both a language-matching `description` and an always-English `description_en` — extracted field values (vendor names, amounts, dates) are explicitly never translated, only this generated prose is. `document.description` is JSON-encoded per-language (`app/db.py::parse_description`/`description_for`), both languages indexed into the existing FTS5 table.
- **Locality-aware tax, currency recorded verbatim (2026-09-24, items 9/10):** `InvoiceFields.currency`/`tax`/`tax_label` (the last two replacing a SG-only `gst` field) capture whatever's actually on the document; `verify.py`'s SG 9% arithmetic check only fires when both the company is SG-local and the invoice's own currency looks like SGD.

## Where the main logic lives (web/src)

| Concern | File |
|---|---|
| Product name (single constant) | `config/product.ts` |
| Nav, copy, stack rows, footer content | `config/site.ts` |
| Shared matching rules (tag / query / event relations) | `features/memories/memoryMatching.ts` |
| Mock memories + tags | `features/memories/mockData.ts` |
| Event → documents/decisions rule | `features/calendar/eventRelations.ts` |
| Logged-out preview search — deliberately still mock, real search lives at `/search` instead (2026-09-22, DECISIONS #41 — this file has no session to call a real endpoint with) | `features/search/searchService.ts` |
| Routes, path parsing, page titles, nav lists | `router/routes.ts` (`ROUTES`, `TAB_ROUTES`, `OPS_NAV_ROUTES`, `NAV_LABEL_KEYS`, `parsePath`) |
| Client-side navigation | `router/Link.tsx`, `router/navigate.ts`, `router/useRoute.ts`, `router/useRouteEffects.ts` |
| Route → page mapping (branches on session for `home`/`calendar`/`tags`, 2026-09-23 DECISIONS #64 added the `home` branch); shared frame shell (optional i18n title/description override) | `pages/Page.tsx`, `pages/FramePage.tsx` |
| Signed-out landing content — deliberately minimal, both CTAs go to `/login` (2026-09-23, DECISIONS #64, replaces the deleted `Hero.tsx`) | `sections/WelcomeHero.tsx` |
| App window chrome around the logged-out Calendar/Tags marketing preview | `features/preview/ProductFrame.tsx` |
| Reusable UI | `components/ui/*` (Button, Badge, Card, Container, Reveal, EmptyState, MemoryCard, SourceLabel, Logo) |
| Upload-outcome toast — non-blocking, 4s auto-dismiss, i18n from the start (2026-09-24, item 1) | `components/ui/Toast.tsx` (`useToast()`), wired in `pages/UploadPage.tsx` |
| Description edit-field state that follows the selected language until the user types (2026-09-24, round 10) — shared by both cards so they cannot drift; regression tests | `features/ops/useEditableDescription.ts`, `features/ops/DocumentCard.i18n.test.tsx` |
| A review card's flagged-reason block: dedupe of two signals for one problem, a sentence or a list, translated field names, no interpolated English (2026-09-24, round 11) — pure logic + a small component used at both places the card shows it | `features/ops/opsShared.tsx` (`dedupeReasons`, `reasonDisplay`), `features/ops/ReviewReasons.tsx`, `features/ops/ReviewReasons.test.tsx` |
| Who may edit a document — one rule shared by the PATCH check and the per-caller `can_edit` on list/search (2026-09-24, round 11) | `app/auth.py` (`may_edit_document`), `app/main.py`, `tests/test_document_permissions.py` |
| Session state, login/logout, role helpers, company-settings save/refresh (2026-09-23, `refreshCompany()`) | `features/auth/AuthContext.tsx`, `features/auth/authApi.ts` |
| Session-gate-and-redirect guard shared by every real-app page (2026-09-23, DECISIONS #59) | `features/auth/RequireSession.tsx` |
| Shared authenticated fetch wrapper (the one place error bodies get parsed) | `lib/apiClient.ts` |
| Client-side photo downscale before upload (2026-09-22) | `lib/imageNormalize.ts` |
| Tap-to-talk voice captioning (Web Speech API, 2026-09-23, DECISIONS #52) | `hooks/useSpeechCaption.ts` |
| i18n bootstrap (i18next instance, language persistence) + locale files — all four real (EN, and ZH/TA/MS since DECISIONS #61 superseded #57's English-value stubs; four strings within ZH/TA/MS from DECISIONS #62 are assistant- not human-translated, `docs/KANBAN.md` Backlog) | `i18n.ts`, `locales/{en,zh,ta,ms}.json` |
| The real logged-in app's shared data layer (documents/expectations/obligations/reviewItems + backend health) and status bar, used by every page below (2026-09-23, DECISIONS #59) | `features/ops/useOpsData.ts`, `features/ops/OpsStatusBar.tsx` |
| Shared field/status components (`DocTypeField`, `BucketField`, `PillPicker`, `VoiceCaptionButton`, `StatusPill` — no badge for `filed`/`processed`, DECISIONS #60 — blob-URL fetch hook; `PictureToggleField` removed 2026-09-23, DECISIONS #67 — the Doc Type "Photo" pill is the only control for this now), translated-label accessors for enum display values (`bucketLabel`/`docTypeLabel`/`roleLabel`/`riskLabel`, DECISIONS #63; `fieldLabel` for extract-result field names, DECISIONS #67 — translate display only, never the stored value), structured review reasons (`parseReviewReasons`/`isFileMissingReason`/`reasonText` — app/graph/verify.py's `{code, params}` dicts translated into the flagged-card sentence, DECISIONS #67, supersedes a pre-joined English sentence), a DD/MM/YYYY masked date input (`isoToDmy`/`dmyToIso`/`DATE_FIELD_NAMES`, DECISIONS #67 — a native `<input type="date">` can't guarantee that display format cross-browser), `formatDocumentLabel`/`DocumentTypeIcon` (DECISIONS #62-63), and the API client (`BUCKETS`/`DOC_TYPES`, all `/api/documents`\|`/api/search`\|etc. calls) | `features/ops/opsShared.tsx`, `features/ops/opsApi.ts` |
| Shared destructive-action confirmation modal ("Delete X? This can't be undone.", 2026-09-23, DECISIONS #60) | `components/ui/ConfirmDialog.tsx` |
| Mobile-only bottom nav (Calendar/Tags/Upload-center/Search/Company Files, role-aware since DECISIONS #64 — `viewer` loses the center Upload button and reflows to four) + the compact account-menu dropdown inside the top bar (persistent role chip + Company Settings link, DECISIONS #62/#64) | `sections/BottomNav.tsx`, `sections/Header.tsx` (`UserMenu`, `visibleNavRoutes`) |
| Company settings — owner-editable, admin read-only, no nav entry or route access below admin (2026-09-23, DECISIONS #64); full role × action matrix | `pages/CompanySettingsPage.tsx`, `docs/PERMISSIONS.md` |
| Upload a document + the review queue — `/upload` | `pages/UploadPage.tsx`, `features/ops/ReviewQueueCard.tsx` |
| Cross-tree "trigger the file picker" signal (bottom-nav FAB → the upload page's dropzone, `window.CustomEvent`, 2026-09-23, DECISIONS #66) | `lib/uploadTrigger.ts` |
| Every document, bucket-filterable (reads `?bucket=` for deep links) — `/company-files` | `pages/CompanyFilesPage.tsx`, `features/ops/DocumentCard.tsx`, `features/ops/DocumentResultsList.tsx` |
| Real, session-scoped full-text search — `/search` | `pages/SearchPage.tsx` |
| Signed-in Calendar hub (dates/obligations/gap analysis merged) and Tags landing (one button per bucket, into Company Files) — same URLs as the marketing `/calendar`/`/tags`, session-branched in `Page.tsx`; Dates renders a real month grid, not a flat list (2026-09-23, DECISIONS #62) | `features/calendar/CalendarHub.tsx`, `features/calendar/DatesView.tsx`, `features/calendar/MonthGrid.tsx`, `features/tags/TagsLanding.tsx` |
| Shared "vendor — doc type / description / doc type" document label + file-type icon, used by Calendar's day list only — not (yet) Company Files, see `docs/KANBAN.md` Backlog (2026-09-23, DECISIONS #62) | `features/ops/opsShared.tsx` (`formatDocumentLabel`, `DocumentTypeIcon`) |
| Login form | `pages/LoginPage.tsx` |

## Commands (run in `web/`)

**Standing preference (2026-09-22): check the deployed Vercel UAT URL
(`https://jagaos.vercel.app`, login required) first, not `npm run dev`.**
The user tests on their phone against that URL, so it needs to actually be
current — that's what git-based auto-deploy (below) is for. Reach for
`npm run dev` only when actively iterating on frontend code locally, and
remember the deployed site won't reflect that iteration until it's pushed.

```bash
npm install
npm run dev          # local iteration only — http://localhost:5173, not what's tested on the phone
npm run typecheck    # tsc, strict (there is no lint yet)
npm run test         # vitest + jsdom + Testing Library (added 2026-09-24, round 10 — two test files: DocumentCard.i18n.test.tsx, ReviewReasons.test.tsx)
npm run build        # typecheck + production build to web/dist
npm run preview      # serve dist on :4173
```

Python backend: `conda activate agent` (conda env, Python 3.11, lives
outside the repo at `/opt/anaconda3/envs/agent`), then
`uvicorn app.main:app --reload` from the repo root. Also localhost-only —
see the callout below on why that matters for `/ops` specifically.

## Deployment notes

- **Vercel UAT (login required):** project `jagaos`, scope `fresfrida`, alias `https://jagaos.vercel.app`. Project protection is `all`, so logged-out requests get 302 to Vercel login (verified 2026-09-21, re-verified 2026-09-22). Runbook and post-deploy check: `docs/UAT-DEPLOYMENT.md`. Real production = AWS Lightsail (GAPS §5), not deployed yet; migrate UAT there later.
- **Git-based auto-deploy** (`vercel git connect` to `github.com/fresfrida/jagaos`) — in progress 2026-09-22, blocked on the `fresfrida` Vercel account needing a GitHub login connection added first (account-level, one-time, via the Vercel dashboard — not something the CLI or an agent can do). Once connected, every push to `main` deploys automatically; Root Directory needs setting to `web` (the repo is no longer web-only — it now holds the Python backend at root too).
- **`/ops` now works from the phone via the Vercel URL** (fixed 2026-09-22, DECISIONS #32) — `VITE_API_BASE_URL` was repointed from `http://127.0.0.1:8000` to `https://13-251-52-222.nip.io` (the live Lightsail backend) and Vercel redeployed. CORS already allowed `jagaos.vercel.app`, so no backend code change was needed, just the env var + redeploy.
- **The Lightsail box's database started empty** — deploying backend *code* there doesn't carry over the local `jaga.db`. `owner@try-demo.test` / "Try Demo Pte Ltd" was re-seeded directly against the live URL: `scripts/seed_dev_db.py`'s target is now configurable (`JAGA_API_BASE_URL` env var, was hardcoded to `127.0.0.1:8000`), run as `JAGA_API_BASE_URL=https://13-251-52-222.nip.io python scripts/seed_dev_db.py` from a machine with the demo PDFs (`evals/demo_corpus/files/`) — no need to copy anything onto the box itself. The local dev DB (`./data/jaga.db`) and the Lightsail DB are now two separate, unsynced databases; seeding one does not seed the other.
- Repo: `github.com/fresfrida/jagaos` (private), pushed 2026-09-22. **`Collaboration: solo` (project CLAUDE.md, added 2026-09-22)**: commit and push freely after each completed task, no explicit ask needed — run `./scripts/prepush-check.sh` first. Redeploying (Lightsail) is separate and still needs an explicit ask. `web/.vercel/` exists locally for CLI deploys: keep it out of git (gitignored). Local author is the neutral `JagaOS`.
- `bootstrap.sh` puts the static site in `/var/www/jaga/web`; copy `web/dist/*` there.
- `deploy/Caddyfile` was edited 2026-09-21 so root static files are served (catch-all `handle`). **Not yet validated** with `caddy validate`; do that on the box.
- UAT and deployment rules (Vercel policy, Lightsail checklist, pre-push check): `docs/UAT-DEPLOYMENT.md`. Run `./scripts/prepush-check.sh` before any push (see `docs/KANBAN.md` Blocked — the script currently has two false-positive checks worth fixing).
- Reverse proxy: `deploy/` uses Caddy; the original brief said Nginx. Undecided, see DECISIONS.md.

## Known risks

- Header: logo, a nav that depends on session state AND role (`aria-current` on the active item) — signed-out shows the marketing tabs Calendar and Tags; signed-in shows the real-app items filtered by role (`Header.tsx`'s `visibleNavRoutes`, 2026-09-23, DECISIONS #64) — Calendar/Tags/Search/Company Files/Upload for user+ (Upload hidden for `viewer`), plus Company Settings appended for admin+ — in that order, plus Log In / (email + Log Out when signed in, or a persistent role chip + avatar menu on phones), Get Started (hidden on phones, still points at the marketing `/calendar` even when signed in — `docs/KANBAN.md` Backlog). The old nav (Product, Use Cases, Security, Stack, Pricing) is gone. The landing (`/`) is a minimal `WelcomeHero` for signed-out visitors only (2026-09-23, DECISIONS #64) — a signed-in visitor is redirected into `/calendar` instead of seeing it. `/how-it-works`, `/stack` and `/get-started` still exist but have no header tab; they are reached from the footer (Guides, Security). Other footer labels are plain-text placeholders. "Log In" now goes to a real `/login` (dev-login placeholder — see the Auth section above for what that means and doesn't mean). **Below `sm` (phones), signed in: the real-app items move to a fixed bottom nav (`sections/BottomNav.tsx`, also role-aware since DECISIONS #64 — `viewer` loses the raised center Upload button and gets four even items instead) rather than the inline list above, and the inline email/Log Out collapse into a single account-menu button (`UserMenu`, with a persistent role chip beside it and a Company Settings link inside it for admin+) — DECISIONS #62, fixing a real overlap bug confirmed on Android Chrome at 375px. Signed-out mobile keeps the inline two-item nav (Calendar, Tags) — light enough to not need the same treatment.**
- The signed-out landing (`WelcomeHero`) has no footer and no scroll — it's deliberately just a heading, one line, and two buttons, so there's no search-results-growth case to worry about (unlike the deleted `Hero.tsx`, which had this exact caveat for its `MemorySearch` box).
- DB schema screenshots are Postgres-flavoured (uuid, enums, `vector(1536)`, RLS, Supabase `auth_subject`); the chosen store is SQLite. Mapping is unresolved.
- Python version drift: `ARCHITECTURE.md` says 3.11, `bootstrap.sh` installs 3.12, conda env `agent` is 3.11.15.
- Fonts load from Google Fonts at runtime (external request).
- PWA is manifest + icon only; no service worker, no offline behaviour.
- Screenshots in `docs/screenshots/` were taken with headless Chrome against `vite preview`.
- **`dev-login`'s known risk (DECISIONS #30) is now live, not theoretical** — the backend is internet-reachable (`https://13-251-52-222.nip.io`) and login is still "any email in, session out," no proof of ownership. This is now the top-priority backlog item (`docs/KANBAN.md`).
- Backend code on Lightsail was deployed by hand (`scp`, not `git clone`) — a future code change there needs a manual re-copy until that's set up. The box's Python is 3.12 (`bootstrap.sh`'s choice), not the repo's documented 3.11 (DECISIONS #7).
- The Lightsail DB and the local dev DB are separate and unsynced — seeding or testing against one has no effect on the other. See "Deployment notes" above.

## How to resume

1. Read `docs/KANBAN.md` (Doing / Blocked), `docs/DECISIONS.md` (especially #28-31, #64), and `docs/PERMISSIONS.md`.
2. Start both servers: `uvicorn app.main:app --reload` from repo root (backend), `cd web && npm run dev` (frontend, local iteration — the deployed `https://jagaos.vercel.app` is what actually gets checked on the phone, per the Commands section above).
3. `python scripts/seed_dev_db.py` (idempotent — safe to re-run) to get a company with data and one account per role — prints `owner@`/`admin@`/`user@`/`viewer@try-demo.test` and each one's dev-login token — rather than starting from an empty `/login` signup.
4. Log in at `/login`, land on `/upload`, upload a document, watch it get classified/extracted, resolve anything flagged, then check `/calendar` (dates/obligations/gap analysis), `/company-files`, `/search`, and — owner/admin only — `/company-settings` (2026-09-23, DECISIONS #59/#64 — six real pages, not one tabbed `/ops`; the old URL still works, redirecting to `/upload`). Log in as each seeded role to see the nav/permission differences firsthand. That loop working, end to end, in the browser, is the current bar — not another backend node.
5. Next real milestones, in the order they'd bite: **review round 11's uncommitted batch** (DECISIONS #74/#75, `docs/PERMISSIONS.md`, `docs/KANBAN.md` Done 2026-09-24 — held back pending a go-ahead; rounds 9 and 10 are already pushed as `1c43ffe` and `304c49e`), and decide the two ⚠ Backlog items it found (anonymous `GET /api/companies`; scanned-PDF 500), then member-management UI (backend's done, no frontend), a product frame with its own styling instead of `/ops`'s debug-console look, deploying this round's and DECISIONS #69's backend changes to Lightsail (`docs/KANBAN.md` Backlog has the full list).
