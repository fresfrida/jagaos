# Portability audit

2026-09-24, item 3 of a 10-item batch. Assessment + config hygiene only —
what runs where today, what was already portable vs. what this round moved
behind config, and what it would actually take to move each piece. No
rewrite happened; every claim below was re-verified against the current
code before being written down, not assumed.

## What runs where today

| Layer | Runs on |
|---|---|
| Frontend (React/Vite static build) | Vercel (`jagaos.vercel.app`), UAT only |
| Backend (FastAPI + LangGraph) | AWS Lightsail, one box, systemd (`jaga-api`) |
| Database | SQLite file on that same box's local disk, WAL mode |
| Document files | Local disk on that same box (`JAGA_DOCS_PATH`) |
| LLM | Not called directly — an OpenAI-compatible gateway in front of AWS Bedrock (Claude Sonnet 4.5), per this hackathon's own infrastructure constraint (`GAPS.md` §5/§9) |
| Image captioning (`jaga-vision`) | Same Lightsail box, a separate isolated systemd service (own venv, BLIP model) |
| Full-text search | SQLite FTS5, same file as the main database |

One box, one process per service, one file for the database. This is a
deliberate shape for a hackathon-scale single-tenant-today product, not an
accident — see "When a move actually becomes necessary" below for what
would force a change.

## Already portable (no work needed, confirmed by reading the code)

These were already env-configurable before this round — re-verified, not
re-flagged as problems:

- `LLM_GATEWAY_BASE_URL` / `LLM_GATEWAY_API_KEY` (`app/llm.py`) — a
  different gateway endpoint or key is a config change, not a code change.
- `JAGA_DB_PATH` (`app/db.py`) — the SQLite file's location.
- `JAGA_VISION_URL` (`app/main.py`) — the captioning service's URL; already
  read from env, though `.env.example` never declared it until this round
  (see "What this round moved" below).

## What this round moved behind config

Two real hardcoded values found while auditing, both fixed:

1. **The model alias** (`"sonnet4.5"`) was a literal string in three call
   sites (`app/graph/classify.py`, `app/graph/extract.py`,
   `app/graph/derive_events.py`). Now `app/llm.py::MODEL_NAME`
   (`LLM_MODEL_NAME` env var, defaults to `"sonnet4.5"` — this project's
   own gateway key only approves that one alias today, `GAPS.md` §11, but
   that's a fact about *this key*, not something that belongs baked into
   every call site).
2. **CORS `allow_origins`** (`app/main.py`) was a hardcoded three-item
   list (localhost dev, Vercel UAT). Now `CORS_ALLOWED_ORIGINS` (comma-
   separated env var), falling back to the same three when unset — a
   different deploy target (a different frontend domain, a staging
   environment) no longer needs a code edit to be reachable.

Also found and fixed as a related but distinct gap (item 7's lifecycle
audit, not this item, but the same class of problem): `JAGA_DOCS_PATH` was
*declared* in `.env.example` since this project's first commit but never
actually *read* anywhere — `app/graph/ingest.py` hardcoded
`./data/docs` regardless of what the env var said. Fixed to actually read
it. `.env.example` now also declares `JAGA_VISION_URL` and
`CORS_ALLOWED_ORIGINS`, which weren't documented there before.

## What's expensive to unwire: the gateway's own quirks

Not a config value — a real behavioral dependency on this specific
gateway, confirmed live (`GAPS.md` §9/§11), not guessed at:

- **Only one model alias is actually callable** on this project's current
  key — `haiku`/`sonnet` are rejected with `400 "Only the approved model
  is allowed"`. The cheap-routing design (haiku classifies, sonnet
  extracts) this project's own strategy doc originally planned is not
  available here. A different provider/gateway might support routing
  again, but the code as it stands assumes one model handles everything.
- **Tool-call output silently truncates at ~256 tokens without an
  explicit `max_tokens`** — confirmed live: a 7-field schema came back
  with only 3 fields, no error, just a truncated JSON object that fails
  Pydantic validation and looks like a schema bug. `app/llm.py` now
  always passes `max_tokens=2048` explicitly. A different gateway/provider
  may not have this default at all, or may truncate at a different point
  — this is exactly the kind of vendor-specific tool-schema-translation
  behavior that doesn't show up until you actually run a multi-field
  extraction against it, and it's the main reason "swap the LLM provider"
  isn't a one-line config change even though the *base URL* is
  configurable — the call-shape assumptions (one model, an explicit
  token ceiling) are baked into how this app talks to it, not just where.

## SQLite is deliberate, not a placeholder

`GAPS.md`/`DECISIONS.md` #3 rule out Supabase (Postgres/RLS/Storage,
pgvector) — this hackathon's own infrastructure constraint only allows AWS
Lightsail plus Bedrock-via-gateway calls, which by elimination makes a
local file database the only stack-compliant option, not an oversight.
Item 6's bilingual-description storage (2026-09-24, same round as this
audit) was decided the same way on purpose: a JSON-encoded TEXT column
(`{"en": "...", "ms": "..."}`, read/written via plain Python
`json.dumps`/`json.loads`, not SQLite's `json1` functions — simpler, no
extra SQL surface for two dict operations) plus pushing every language
variant into the existing FTS5 `document_search` table, rather than
building new search infrastructure or a real `jsonb` column this project's
own database doesn't have.

**Migration path, if this project ever does move to Postgres** — named
explicitly, not guessed at:

- The JSON-encoded TEXT column maps directly to a real `jsonb` column;
  `parse_description()`/`description_for()` (`app/db.py`) already isolate
  every reader from the raw column format — nothing above that layer reads
  `document.description` directly (confirmed by grep across the whole
  backend), so migrating the column type doesn't require touching
  classify.py/main.py's edit endpoint/verify.py.
- FTS5 maps to a `tsvector` column + a GIN index; the query shape
  (`document_search`'s `MATCH`, `build_fts5_query()`) would need a real
  rewrite to Postgres full-text search syntax, but the *data* going into
  it (both languages' text, space-joined) doesn't change.
- **The actual swap point is `app/db.py`'s own functions** — `get_conn`,
  `reindex_document_search`, `parse_description`/`description_for`,
  `build_fts5_query` — not the call sites that use them. Every graph node
  and every endpoint in `app/main.py` goes through these, never raw SQL
  against `document`/`document_search` directly (confirmed by grep) — if
  that boundary is respected going forward, application code above it
  shouldn't need to change for a database swap, only these functions'
  internals.

## When a move actually becomes necessary

Not a data-volume question — SQLite comfortably handles far more rows
than this project has today (a few hundred documents across a handful of
companies). WAL mode (`app/db.py`, already enabled) already lets reads and
writes happen concurrently without blocking each other — this is a
genuinely single-writer-friendly workload today: one company's admin
uploading a document, one reviewer resolving a review item, at a time.

**The real trigger is concurrent writers, not row count**: SQLite's
single-writer model means two companies' users writing at literally the
same instant serialize behind each other at the database level (a lock
wait, not a crash — WAL mode makes this graceful, not silent data loss,
but it is a real ceiling). This stays invisible at demo/single-tenant
scale and becomes a real, measurable latency problem only once there are
enough simultaneous companies with enough simultaneous active users that
write collisions happen often enough to be felt — the shape of that
threshold is "many concurrent companies each with active users," not
"many total documents stored." Nothing in the current codebase makes that
threshold worse or better than SQLite's own well-documented single-writer
ceiling; this project doesn't do anything unusual with the database that
would trigger a move earlier than that.
