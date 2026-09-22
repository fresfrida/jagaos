# Handoff

Last updated: 2026-09-22. Read this first when resuming.

**Priority as of 2026-09-22 (DECISIONS #28): the product is testing agents
IN the app.** Backend pipeline work (classify/extract/verify/etc.) and
deploy plumbing (Vercel auto-deploy) are both treated as done for now. What
matters next is the logged-in, role-based app surface — see "Backend
status" and "How to resume" below.

## What this is

**JagaOS** — company memory for SMEs: capture documents, conversations, invoices and decisions, then retrieve them with natural-language search and cited sources.

This repo currently holds:
- **Planning docs** at root, moved into `MDs/` by the user 2026-09-22 (`ARCHITECTURE.md`, `PLATFORM.md`, `UI-SPEC.md`, `GAPS.md`, ...). Written for the earlier "JagaOS = Singapore corp-sec records keeper" concept. Useful context, not automatically current. `GAPS.md` §5 is still binding.
- **`web/`** — the marketing landing page (mock data, logged-out) plus the real logged-in app (`/login`, `/ops`, session-backed). See "Where the main logic lives" below.
- **`app/`** — backend, per `ARCHITECTURE.md` §9 plus a 4-role auth layer (`app/auth.py`, 2026-09-22, DECISIONS #29-31). See "Backend status" below.
- **`evals/`** — eval runner + adversarial cases, `evals/report.md` committed (10/10 passing, no gateway key needed).
- **`tests/`** — pytest: deterministic core, live-gateway, review pause/resume, and auth/tenant-isolation (`tests/test_auth.py`). 31/31 passing.
- **`deploy/`** — Lightsail provisioning (Caddy, systemd, `bootstrap.sh`). Untouched.
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
`/ops` (`web/src/features/ops/OpsConsole.tsx`) is now session-scoped and
role-aware — upload hidden below `user`, review Accept/Reject hidden below
`admin` — instead of its own company create/switch UI. `web/src/lib/apiClient.ts`
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
| Logged-out preview search — deliberately still mock, real search lives in `/ops` instead (2026-09-22, DECISIONS #41 — this file has no session to call a real endpoint with) | `features/search/searchService.ts` |
| Routes, path parsing, page titles, header tabs | `router/routes.ts` (`ROUTES`, `TAB_ROUTES`, `parsePath`) |
| Client-side navigation | `router/Link.tsx`, `router/navigate.ts`, `router/useRoute.ts`, `router/useRouteEffects.ts` |
| Route → page mapping; shared frame shell | `pages/Page.tsx`, `pages/FramePage.tsx` |
| App window chrome around Calendar/Tags | `features/preview/ProductFrame.tsx` |
| Reusable UI | `components/ui/*` (Button, Badge, Card, Container, Reveal, EmptyState, MemoryCard, SourceLabel, Logo) |
| Session state, login/logout, role helpers | `features/auth/AuthContext.tsx`, `features/auth/authApi.ts` |
| Shared authenticated fetch wrapper (the one place error bodies get parsed) | `lib/apiClient.ts` |
| Client-side photo downscale before upload (2026-09-22) | `lib/imageNormalize.ts` |
| The real logged-in app: upload, review queue, gap analysis, obligations, trace, archive, real search, an in-page document preview, date grouping — 5 tabs, not one long scroll (2026-09-22, DECISIONS #36, #37, #41-44) | `features/ops/OpsConsole.tsx`, `features/ops/opsApi.ts` |
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

- Header: logo, tabs Calendar and Tags (`aria-current` on the active one), Log In / (email + Log Out when signed in), Get Started (hidden on phones). The old nav (Product, Use Cases, Security, Stack, Pricing) is gone. The landing (`/`) is hero-only. `/how-it-works`, `/stack` and `/get-started` still exist but have no header tab; they are reached from the footer (Guides, Security). Other footer labels are plain-text placeholders. "Log In" now goes to a real `/login` (dev-login placeholder — see the Auth section above for what that means and doesn't mean).
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
4. Log in at `/login`, land on `/ops`, upload a document, watch it get classified/extracted, resolve anything flagged, see the gap analysis and obligations. That loop working, end to end, in the browser, is the current bar — not another backend node.
5. Next real milestones, in the order they'd bite: member-management UI (backend's done, no frontend), a company settings page, a product frame with its own styling instead of `/ops`'s debug-console look (`docs/KANBAN.md` Backlog has the full list).
