/** Thin fetch wrapper over the real backend (app/main.py): the actual
 * ARCHITECTURE.md pipeline (documents/expectations/obligations/trace).
 * Base URL: VITE_API_BASE_URL (web/.env, never committed).
 *
 * Every call here requires a session (2026-09-22) — company_id is no
 * longer a parameter anywhere; the backend derives it from the bearer
 * token via app/auth.py. Auth itself (login/me/logout, token storage)
 * lives in features/auth/authApi.ts; this file imports authHeaders()
 * rather than re-implementing it. */

import { API_BASE_URL, apiRequest } from '../../lib/apiClient'
import { authHeaders } from '../auth/authApi'

// 2026-09-22 (DECISIONS #42): fixed taxonomy, supersedes the tag table —
// "only upgrade to a real tags table if users later need to invent their
// own." Shared here so the Company Files page's bucket-filter chips, the
// Tags landing page's bucket buttons, and the bucket dropdown editors in
// DocumentCard/ReviewQueueCard all read from one list, not several copies.
export const BUCKETS = [
  'Receivables', 'Expenses', 'Statutory', 'Operations', 'Contracts', 'Memory Lane', 'Miscellaneous',
] as const
export type Bucket = (typeof BUCKETS)[number]

// 2026-09-22 (DECISIONS #45): doc_type's fixed vocabulary for the invoice/
// important/memory lanes — mirrors app/graph/classify.py's SYSTEM prompt
// exactly (single source of truth for the list itself; this is the
// frontend's copy of it, not a second definition of what the values mean).
// The statutory lane's doc_type is deliberately NOT this — it stays free
// text (matched against expectation slugs by
// derive_expectations.py::_matches_doc_type) — callers key off a
// document's `lane` to decide which UI applies, this constant only.
export const DOC_TYPES = [
  'invoice', 'receipt', 'PO', 'quotation', 'delivery_order', 'contract', 'photo', 'other',
] as const
export type DocType = (typeof DOC_TYPES)[number]

export interface ClassifyResult {
  lane: string
  doc_type: string
  confidence: number
  injection_suspected: boolean
  // null (2026-09-23): the "is this a picture?" upload toggle skips the
  // LLM call that would normally write this, leaving it an explicit
  // pending-caption state rather than a guessed sentence.
  description: string | null
  bucket: Bucket
  vendor_name: string | null
}

export interface ProvenanceValue {
  value: unknown
  confidence: number
  page: number | null
  char_start: number | null
  char_end: number | null
}

// 2026-09-23 (live regression report, items 7/8/10b): a structured reason
// — `code` names an ops.review.reasons.<code> i18n key, `params` its
// interpolation values. Supersedes a pre-joined English sentence the
// backend used to build (it has no notion of the caller's language); the
// frontend now owns the translated phrasing. See opsShared.tsx's
// reasonDisplay().
export interface ReviewReason {
  code: string
  params: Record<string, string>
}

export interface VerifyResult {
  ok: boolean
  reasons: ReviewReason[]
  needs_review: boolean
}

/** Who a document is for (2026-09-24, round 13, DECISIONS #85): 'company' —
 * visible per the normal role rules — or 'only_me', a personal file only its
 * uploader can ever see. Mirrors app/models.py's Visibility. */
export type Visibility = 'company' | 'only_me'

export interface UploadResult {
  // null for a 'duplicate' of a document the caller cannot see: the server says
  // "already uploaded" without naming a document they have no right to know of.
  document_id: number | null
  // 'processed' (auto-filed, no human touch) is no longer possible as of
  // 2026-09-22 (DECISIONS #40) — every non-quarantined upload now needs
  // review, even a clean one.
  // 'filed' (round 21, A3, DECISIONS #101): a personal file, named by its owner, is filed on the spot: no review.
  status: 'needs_review' | 'quarantined' | 'duplicate' | 'filed'
  classify?: ClassifyResult
  extract?: Record<string, ProvenanceValue | boolean> | null
  verify?: VerifyResult
  events?: unknown[]
  obligations_created?: number
  // review (2026-09-22, DECISIONS #47) — no longer read anywhere in the
  // frontend (2026-09-23, live regression report item 3: the "Last
  // upload result" banner that used it was removed outright, the review
  // queue below already communicates the outcome). Left typed here only
  // because the backend still sends it (app/main.py's upload response,
  // untouched) — `question` is now JSON-encoded reasons, not a sentence.
  review?: { reason: string | null; question: string | null } | null
  review_item_id?: number | null
}

export interface DocumentRow {
  id: number
  filename: string
  media_type: string
  lane: string | null
  doc_type: string | null
  status: string
  received_at: string
  // JSON-encoded {"en": "...", "<language>": "..."} since items 5/6
  // (2026-09-24) — null means no description at all yet (DECISIONS #52's
  // pending-caption state), never an empty JSON string. Parse with
  // opsShared.tsx's descriptionFor(), never rendered directly.
  description: string | null
  bucket: string | null
  vendor_name: string | null
  // Document's own date (invoice/statutory issued_on, or EXIF for photos)
  // vs received_at's upload timestamp — null whenever the source document
  // has no discoverable date of its own (2026-09-22, DECISIONS #43).
  occurred_on: string | null
  // 2026-09-24 (round 11): the server's own answer (app/auth.py::
  // may_edit_document) for THIS caller — a `user` can only edit documents
  // they uploaded, so an Edit button on someone else's would only ever
  // 403. Trust this over re-deriving the rule from the role here.
  // Optional on purpose: a backend older than this field (the Vercel
  // frontend deploys on push, the Lightsail backend only when someone
  // redeploys it) sends nothing — see opsShared.tsx's documentIsEditable.
  can_edit?: boolean
  // Round 21 (DECISIONS #102): a row the OWNER asked to have purged and the team has not yet removed has `status`
  // 'purge_requested' (shown as a pill) and `can_edit` false. Only the owner is ever sent one.
  // 2026-09-24 (round 13, DECISIONS #85): 'only_me' for a personal file — only
  // its uploader ever receives such a row. Round 19 (DECISIONS #94): the company
  // list no longer carries personal files at all; they come from
  // GET /api/personal-files (the "Only me" section) and every row there says
  // 'only_me'. Absent from an older backend, which has no personal files.
  visibility?: Visibility
}

/** One word of the Search page's word cloud (round 21, A8, DECISIONS #101): `count` is how many documents contain it. */
export interface SearchTerm {
  term: string
  count: number
}

/** One pending purge request (round 21, A5, DECISIONS #101): what the owner asked to have removed permanently. */
export interface PurgeRequest {
  id: number
  filename: string
  /** What names the document as a person would (DECISIONS #109): the same columns a document card uses. Optional, because a backend
   * from before that change does not send them; the section then shows the file name alone, as it always did. */
  description?: string | null
  doc_type?: string | null
  vendor_name?: string | null
  requested_at: string
  requested_by: string | null
}

/** GET /api/limits (round 20, DECISIONS #99). */
export interface Limits {
  max_file_bytes: number
  max_personal_files: number
  personal_files_used: number
}

export interface Expectation {
  id: number
  doc_type: string
  label: string
  due_on: string | null
  status: string
  // 2026-09-24 (round 16, DECISIONS #90): the document that made a 'satisfied' row
  // satisfied, sent only when THIS caller may see it (else null). Optional: a
  // backend older than the field sends none, and the row then simply has no link.
  evidence_document_id?: number | null
}

export interface Obligation {
  id: number
  kind: string
  label: string
  due_on: string
  status: string
  citation: string
  risk: string
}

export interface ReviewItem {
  id: number
  document_id: number
  document_filename: string
  document_media_type: string
  // Same JSON-encoded shape as DocumentRow.description above.
  document_description: string | null
  document_bucket: string | null
  // Read-only here (not part of DocumentEditRequest) - decides whether
  // doc_type below renders as the fixed dropdown or the statutory lane's
  // free-text input; not itself editable from this card.
  document_lane: string | null
  document_doc_type: string | null
  document_vendor_name: string | null
  // 2026-09-24 (round 13, DECISIONS #85): 'only_me' for a personal file, and the
  // server's own answer to "may THIS caller accept/reject this item"
  // (auth.may_resolve_review_item) — admin/owner, or the uploader of their own
  // personal file. Both optional: an older backend sends neither, and the card
  // then falls back to the role check it always used.
  document_visibility?: Visibility
  can_resolve?: boolean
  thread_id: string
  // reason: a short debug/trace string (codes joined, e.g. "gst_mismatch"),
  // no longer load-bearing for the UI (2026-09-23, items 7/8/10b).
  reason: string
  // question: JSON-encoded ReviewReason[] — parse with opsShared.tsx's
  // parseReviewReasons() rather than rendering directly.
  question: string
  proposed_json: string
  status: string
}

export interface ResolveResult {
  status: string
  events: unknown[] | null
  obligations_created: number | null
}

export interface TraceReport {
  nodes: Array<{
    node: string
    model: string | null
    input_tokens: number | null
    output_tokens: number | null
    cost_usd: number | null
    latency_ms: number | null
    decision: string | null
    at: string
  }>
  total_cost_usd: number
}

/** What a caller may attach to an upload beyond the file itself. */
export interface UploadOptions {
  /** The compliance-checklist item's doc_type slug this upload was started from. */
  docTypeHint?: string | null
  /** 'only_me' for a personal file (the "Only me" section); omitted means the company's. */
  visibility?: Visibility
  /** A personal file's name and caption, as the person typed them (round 21, A3, DECISIONS #101). The server uses them for
   * an Only me upload and ignores them for a company one. */
  name?: string
  caption?: string
}

function applyUploadOptions(params: URLSearchParams, { docTypeHint, visibility, name, caption }: UploadOptions): void {
  if (docTypeHint) params.set('doc_type_hint', docTypeHint)
  if (visibility && visibility !== 'company') {
    params.set('visibility', visibility)
    if (name) params.set('name', name)
    if (caption) params.set('caption', caption)
  }
}

/** Every ops call carries the session automatically — callers never pass
 * a token or a company_id by hand. */
function request<T>(path: string, init?: RequestInit): Promise<T> {
  return apiRequest<T>(path, { ...init, headers: { ...authHeaders(), ...init?.headers } })
}

export const opsApi = {
  health: () => request<{ status: string }>('/api/health'),

  // isPicture (2026-09-23): the upload-time "is this a picture, not a
  // document?" toggle — sent as a query param alongside source_channel
  // (multipart body carries the file only), read by app/main.py to skip
  // classify.py's LLM call entirely for this document.
  // language (2026-09-24, item 5): the uploader's currently-selected UI
  // language (i18n.language) — read by classify.py to generate
  // description directly in that language instead of always English.
  // options.visibility (round 19, DECISIONS #94): who the file is for. Every upload
  // is a company file unless it is sent to the "Only me" section, which passes
  // 'only_me' (a personal file: its uploader alone, for every role). There is no
  // per-file switch afterwards any more (the lock toggle was removed).
  // options.docTypeHint (2026-09-24, round 16, DECISIONS #90): the doc_type slug of
  // the compliance checklist item the upload was started from. A suggestion to the
  // classifier only; the server ignores anything that is not a real checklist slug.
  uploadDocument: (file: File, isPicture: boolean, language: string, options: UploadOptions = {}) => {
    const form = new FormData()
    form.append('file', file)
    const params = new URLSearchParams({ source_channel: 'web', is_picture: String(isPicture), language })
    applyUploadOptions(params, options)
    return request<UploadResult>(`/api/documents?${params}`, { method: 'POST', body: form })
  },

  // Several photos of one document, in page order (2026-09-24, round 12,
  // DECISIONS #78): the backend merges them into one PDF and runs it through
  // the same pipeline as any upload — one document, one review item. The
  // order of `pages` IS the page order. app/main.py::upload_document_pages.
  uploadPages: (pages: File[], language: string, options: UploadOptions = {}) => {
    const form = new FormData()
    for (const page of pages) form.append('files', page)
    const params = new URLSearchParams({ language })
    applyUploadOptions(params, options)
    return request<UploadResult>(`/api/documents/pages?${params}`, { method: 'POST', body: form })
  },

  listDocuments: () => request<DocumentRow[]>('/api/documents'),

  // The caller's OWN personal files, for the "Only me" section (round 19, DECISIONS
  // #94). Same row shape as listDocuments; nobody else's, ever.
  listPersonalFiles: () => request<DocumentRow[]>('/api/personal-files'),

  // Round 20 (item 6, DECISIONS #99): the upload limits, and how many of the private-file slots this person
  // has used. A backend older than this answers 404, and callers treat that as "no limits known".
  getLimits: () => request<Limits>('/api/limits'),

  // Delete a PRIVATE file for good (its uploader only). `confirm` must be the file's exact name. Irreversible.
  purgeDocument: (documentId: number, confirm: string) =>
    request<{ status: string; file_removed: boolean }>(`/api/documents/${documentId}/purge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm }),
    }),

  // The OWNER asks for a company document to be removed permanently (round 21, A5, DECISIONS #101). Nothing is
  // deleted: the document is archived, flagged, and the team purges it. The list is owner-only.
  requestPurge: (documentId: number) =>
    request<{ status: string }>(`/api/documents/${documentId}/request-purge`, { method: 'POST' }),
  listPurgeRequests: () => request<PurgeRequest[]>('/api/purge-requests'),
  // Round 3, item 9b (DECISIONS #121): the owner takes a PENDING request back. The document returns to the status it had (the answer's
  // `status`), nothing having been deleted. Once the team has purged the row there is nothing left to cancel.
  cancelPurgeRequest: (documentId: number) =>
    request<{ status: string }>(`/api/documents/${documentId}/cancel-purge-request`, { method: 'POST' }),

  // The word cloud on Search (round 21, A8, DECISIONS #101): the most telling words across the company's documents the caller
  // may see, with the number of documents each is in. A backend older than this answers 404.
  searchTerms: () => request<SearchTerm[]>('/api/search/terms'),

  listExpectations: () => request<Expectation[]>('/api/expectations'),

  listObligations: () => request<Obligation[]>('/api/obligations'),

  listReviewItems: () => request<ReviewItem[]>('/api/review'),

  resolveReview: (
    reviewItemId: number,
    threadId: string,
    body: { action: 'confirm' | 'reject'; corrected_fields: Record<string, unknown> },
  ) =>
    request<ResolveResult>(
      `/api/review/${reviewItemId}/resolve?${new URLSearchParams({ thread_id: threadId })}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    ),

  getTrace: (documentId: number) => request<TraceReport>(`/api/trace/${documentId}`),

  // Deliberately named archiveDocument, not deleteDocument (2026-09-23):
  // this calls the existing /archive endpoint and sets status='archived'
  // (DECISIONS #53), and that internal name is staying — this is a
  // user-facing label fix only, not a data-model rename. The UI now shows
  // "Delete" everywhere this action appears, because it functionally is
  // permanent from the app's own perspective (no role, not even owner,
  // can ever see the document again — only direct database access can);
  // calling it "Archive" in the UI implied a recoverability nobody using
  // the app actually has. If a future change makes this genuinely
  // reversible, the internal name and the label should probably converge.
  archiveDocument: (documentId: number) =>
    request<{ status: string }>(`/api/documents/${documentId}/archive`, { method: 'POST' }),

  // Real search (2026-09-22): the actual, tenant-scoped search over real
  // documents, so it lives here with everything else that needs the session.
  // (A mock search service for the logged-out preview used to sit in
  // features/search/; it was removed with the sample pages, DECISIONS #107.)
  search: (q: string) => request<DocumentRow[]>(`/api/search?${new URLSearchParams({ q })}`),

  editDocument: (
    documentId: number,
    body: {
      description?: string
      // language (2026-09-24, items 5/6): which language `description`
      // above is written in — app/main.py::edit_document merges it into
      // just that one key of the stored {"en": ..., "<language>": ...}
      // blob, not overwrite every language's text with a single-language
      // correction. Only meaningful alongside `description`.
      language?: string
      bucket?: Bucket
      vendor_name?: string
      doc_type?: string
      filename?: string
      // is_picture (2026-09-23): one-directional — true re-marks this
      // document as a picture (lane/doc_type/bucket set deterministically
      // server-side, app/main.py::edit_document); there's no reverse.
      is_picture?: boolean
    },
  ) =>
    request<{ status: string }>(`/api/documents/${documentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  // Not routed through request()/apiRequest() — those assume a JSON body
  // (res.json()). <img>/<embed> can't send the Authorization header a
  // direct <img src> to this endpoint would need, so the review card
  // fetches the bytes itself and points at a local blob: URL instead.
  fetchDocumentFile: (documentId: number): Promise<Blob> =>
    fetch(`${API_BASE_URL}/api/documents/${documentId}/file`, { headers: authHeaders() }).then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return res.blob()
    }),
  // Round 20 (item 5, DECISIONS #97): a small JPEG of a PDF's first page, made by the server on the
  // first request and cached there. A 404 (not a PDF, cannot be rendered, or not yours to see) is
  // just "no thumbnail": the card keeps its generic icon.
  fetchDocumentThumbnail: (documentId: number): Promise<Blob> =>
    fetch(`${API_BASE_URL}/api/documents/${documentId}/thumbnail`, { headers: authHeaders() }).then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return res.blob()
    }),
}
