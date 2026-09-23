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
- **`web/`** — the marketing landing page (mock data, logged-out) plus the real logged-in app: `/login`, then five URL-addressable pages (`/upload`, `/company-files`, `/search`, plus `/calendar` and `/tags` which double as the signed-in Calendar hub and Tags landing page once authenticated — DECISIONS #59, 2026-09-23, supersedes the old single tabbed `/ops` page, kept only as a redirect to `/upload`). Session-backed throughout. See "Where the main logic lives" below.
- **`app/`** — backend, per `ARCHITECTURE.md` §9 plus a 4-role auth layer (`app/auth.py`, 2026-09-22, DECISIONS #29-31). See "Backend status" below.
- **`evals/`** — eval runner + adversarial cases, `evals/report.md` committed (10/10 passing, no gateway key needed).
- **`tests/`** — pytest: deterministic core, live-gateway, review pause/resume, auth/tenant-isolation, and vision-caption async wiring (`tests/test_vision_caption.py`, mocked, no torch). 39/39 passing (most need no gateway key).
- **`deploy/`** — Lightsail provisioning (Caddy, systemd, `bootstrap.sh`, plus `jaga-vision.service`, DECISIONS #55). **`jaga-vision` is now deployed and confirmed working on production** (2026-09-23, DECISIONS #56 — a real uploaded photo got a correct caption, checked directly in the live DB); `MemoryMax` enforcement and the exact dependency versions running on the box are still unconfirmed, see "Known gaps" below.
- **`vision/`** — isolated image-captioning service (own venv, `Salesforce/blip-image-captioning-base`), 2026-09-23, DECISIONS #55. Deliberately separate from `app/` — see "Backend status" below.
- **Python env** — conda env `agent` (Python 3.11.16), `requirements.txt` installed.
- **`DB/`** — schema screenshots (source of truth for tables; no SQL file exists). `app/db.py` implements the SQLite translation per `ARCHITECTURE.md` §2.
- **GitHub**: `github.com/fresfrida/jagaos` (private). **Collaboration mode is `solo` as of 2026-09-22** (project `CLAUDE.md`'s first line) — commit and push freely after each completed task, no explicit ask needed; `./scripts/prepush-check.sh` still runs before every push. Redeploying the Lightsail backend (not git-triggered) still needs an explicit ask either way.

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

**Known gaps, in the order they'll bite:**
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
- **`zh.json`/`ta.json`/`ms.json` (DECISIONS #57) are English-value placeholders, not real translations** — selecting 中文/தமிழ்/BM in the header today changes the stored language code and re-renders through i18next, but every string still reads in English. Real translations are a separate, deferred task (`docs/KANBAN.md` Backlog).

## Auth (added 2026-09-22, DECISIONS #28-31)

Every data endpoint requires a session and derives `company_id` from the
caller's membership — never from a client-supplied parameter (closes a
real tenant-isolation gap; every endpoint previously trusted whatever
`company_id` the client sent). 4 roles, numeric order in `app/auth.py`:
`viewer < user < admin < owner`. Permissions: viewer reads; user also
uploads; admin also resolves reviews and adds members; owner also manages
the company. This is a **simpler, generic set than `PLATFORM.md`'s original
six** (owner/director/staff/accountant/corpsec/auditor) — a deliberate
supersession (DECISIONS #29), not an oversight. **Resolved 2026-09-22**:
corp sec maps to `viewer` (sees everything, changes nothing — already what
the role does, no new name needed); **one `owner` per company, many
`admin`s**, enforced in `add_member` (`app/main.py`), not just documented —
adding a second owner is a 409.

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
attributes uploads. Endpoints: `POST /api/auth/dev-login`, `GET
/api/auth/me`, `POST /api/auth/logout`, `GET`/`POST
/api/companies/{id}/members`. Tests: `tests/test_auth.py` (13/13, no gateway
key needed — pure DB/HTTP against `TestClient`).

Frontend: `web/src/features/auth/` (`AuthContext`/`useAuth`, `authApi.ts`
for session storage + the auth calls), `web/src/pages/LoginPage.tsx`.
The real app's five pages (`/upload`, `/company-files`, `/search`, plus
the signed-in `/calendar`/`/tags`, DECISIONS #59) are session-scoped and
role-aware via the shared `RequireSession`/`useAuth` — upload hidden below
`user`, review Accept/Reject hidden below `admin` — instead of a company
create/switch UI. `web/src/lib/apiClient.ts`
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
- **Documented, not built:** upload/Telegram ingestion (`ARCHITECTURE.md` §3's original plan). FTS5 search itself is now built (previous bullet). **"Validation (Jev)" never happened and isn't needed** — confirmed 2026-09-22 (DECISIONS #46) that `Jev`/`langchain-typesafe` has zero references anywhere in this codebase; the actual validation step is `app/graph/verify.py`'s deterministic GST-arithmetic and confidence-floor checks, which has been built and tested since the original backend skeleton (2026-09-21) — a different, real implementation of the same job, not a gap.

## Where the main logic lives (web/src)

| Concern | File |
|---|---|
| Product name (single constant) | `config/product.ts` |
| Nav, copy, stack rows, footer content | `config/site.ts` |
| Shared matching rules (tag / query / event relations) | `features/memories/memoryMatching.ts` |
| Mock memories + tags | `features/memories/mockData.ts` |
| Event → documents/decisions rule | `features/calendar/eventRelations.ts` |
| Logged-out preview search — deliberately still mock, real search lives at `/search` instead (2026-09-22, DECISIONS #41 — this file has no session to call a real endpoint with) | `features/search/searchService.ts` |
| Routes, path parsing, page titles, nav lists | `router/routes.ts` (`ROUTES`, `TAB_ROUTES`, `OPS_NAV_ROUTES`, `parsePath`) |
| Client-side navigation | `router/Link.tsx`, `router/navigate.ts`, `router/useRoute.ts`, `router/useRouteEffects.ts` |
| Route → page mapping (branches on session for `calendar`/`tags`); shared frame shell (optional i18n title/description override) | `pages/Page.tsx`, `pages/FramePage.tsx` |
| App window chrome around the logged-out Calendar/Tags marketing preview | `features/preview/ProductFrame.tsx` |
| Reusable UI | `components/ui/*` (Button, Badge, Card, Container, Reveal, EmptyState, MemoryCard, SourceLabel, Logo) |
| Session state, login/logout, role helpers | `features/auth/AuthContext.tsx`, `features/auth/authApi.ts` |
| Session-gate-and-redirect guard shared by every real-app page (2026-09-23, DECISIONS #59) | `features/auth/RequireSession.tsx` |
| Shared authenticated fetch wrapper (the one place error bodies get parsed) | `lib/apiClient.ts` |
| Client-side photo downscale before upload (2026-09-22) | `lib/imageNormalize.ts` |
| Tap-to-talk voice captioning (Web Speech API, 2026-09-23, DECISIONS #52) | `hooks/useSpeechCaption.ts` |
| i18n bootstrap (i18next instance, language persistence) + locale files — EN complete, ZH/TA/MS are English-value stubs pending real translation (2026-09-23, DECISIONS #57) | `i18n.ts`, `locales/{en,zh,ta,ms}.json` |
| The real logged-in app's shared data layer (documents/expectations/obligations/reviewItems + backend health) and status bar, used by every page below (2026-09-23, DECISIONS #59) | `features/ops/useOpsData.ts`, `features/ops/OpsStatusBar.tsx` |
| Shared field/status components (`DocTypeField`, `PillPicker`, `VoiceCaptionButton`, `PictureToggleField`, `StatusPill` — no badge for `filed`/`processed`, DECISIONS #60 — blob-URL fetch hook) and the API client (`BUCKETS`/`DOC_TYPES`, all `/api/documents`\|`/api/search`\|etc. calls) | `features/ops/opsShared.tsx`, `features/ops/opsApi.ts` |
| Shared destructive-action confirmation modal ("Delete X? This can't be undone.", 2026-09-23, DECISIONS #60) | `components/ui/ConfirmDialog.tsx` |
| Upload a document + the review queue — `/upload` | `pages/UploadPage.tsx`, `features/ops/ReviewQueueCard.tsx` |
| Every document, bucket-filterable (reads `?bucket=` for deep links) — `/company-files` | `pages/CompanyFilesPage.tsx`, `features/ops/DocumentCard.tsx`, `features/ops/DocumentResultsList.tsx` |
| Real, session-scoped full-text search — `/search` | `pages/SearchPage.tsx` |
| Signed-in Calendar hub (dates/obligations/gap analysis merged) and Tags landing (six bucket buttons into Company Files) — same URLs as the marketing `/calendar`/`/tags`, session-branched in `Page.tsx` | `features/calendar/CalendarHub.tsx`, `features/calendar/DatesView.tsx`, `features/tags/TagsLanding.tsx` |
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
npm run typecheck    # tsc, strict (there is no lint or test runner yet)
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

- Header: logo, a nav that depends on session state (`aria-current` on the active item) — signed-out shows the marketing tabs Calendar and Tags; signed-in shows all five real-app items, Calendar/Tags/Search/Company Files/Upload, in that order (2026-09-23, DECISIONS #59) — plus Log In / (email + Log Out when signed in), Get Started (hidden on phones, still points at the marketing `/calendar` even when signed in — `docs/KANBAN.md` Backlog). The old nav (Product, Use Cases, Security, Stack, Pricing) is gone. The landing (`/`) is hero-only. `/how-it-works`, `/stack` and `/get-started` still exist but have no header tab; they are reached from the footer (Guides, Security). Other footer labels are plain-text placeholders. "Log In" now goes to a real `/login` (dev-login placeholder — see the Auth section above for what that means and doesn't mean).
- The landing has no footer and no scroll, but the hero grows if search results are shown on a very short viewport (verified fine at 1440x900).
- DB schema screenshots are Postgres-flavoured (uuid, enums, `vector(1536)`, RLS, Supabase `auth_subject`); the chosen store is SQLite. Mapping is unresolved.
- Python version drift: `ARCHITECTURE.md` says 3.11, `bootstrap.sh` installs 3.12, conda env `agent` is 3.11.15.
- Fonts load from Google Fonts at runtime (external request).
- PWA is manifest + icon only; no service worker, no offline behaviour.
- Screenshots in `docs/screenshots/` were taken with headless Chrome against `vite preview`.
- **`dev-login`'s known risk (DECISIONS #30) is now live, not theoretical** — the backend is internet-reachable (`https://13-251-52-222.nip.io`) and login is still "any email in, session out," no proof of ownership. This is now the top-priority backlog item (`docs/KANBAN.md`).
- Backend code on Lightsail was deployed by hand (`scp`, not `git clone`) — a future code change there needs a manual re-copy until that's set up. The box's Python is 3.12 (`bootstrap.sh`'s choice), not the repo's documented 3.11 (DECISIONS #7).
- The Lightsail DB and the local dev DB are separate and unsynced — seeding or testing against one has no effect on the other. See "Deployment notes" above.

## How to resume

1. Read `docs/KANBAN.md` (Doing / Blocked) and `docs/DECISIONS.md`, especially #28-31.
2. Start both servers: `uvicorn app.main:app --reload` from repo root (backend), `cd web && npm run dev` (frontend, local iteration — the deployed `https://jagaos.vercel.app` is what actually gets checked on the phone, per the Commands section above).
3. `python scripts/seed_dev_db.py` if you want a company with data already in it (idempotent — safe to re-run) rather than starting from an empty `/login` signup.
4. Log in at `/login`, land on `/upload`, upload a document, watch it get classified/extracted, resolve anything flagged, then check `/calendar` (dates/obligations/gap analysis), `/company-files`, and `/search` (2026-09-23, DECISIONS #59 — five real pages, not one tabbed `/ops`; the old URL still works, redirecting to `/upload`). That loop working, end to end, in the browser, is the current bar — not another backend node.
5. Next real milestones, in the order they'd bite: member-management UI (backend's done, no frontend), a company settings page, a product frame with its own styling instead of `/ops`'s debug-console look (`docs/KANBAN.md` Backlog has the full list).
