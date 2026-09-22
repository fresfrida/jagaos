/** Thin fetch wrapper over the real backend (app/main.py). Separate from
 * features/search/searchService.ts on purpose: that boundary is for the
 * marketing preview's mock "memories" model, this one talks to the actual
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
// own." Shared here so the bucket-filter chips and the bucket dropdown
// editor in OpsConsole.tsx both read from one list, not two copies.
export const BUCKETS = [
  'Receivables', 'Expenses', 'Statutory', 'Operations', 'Memory Lane', 'Miscellaneous',
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
  description: string
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

export interface VerifyResult {
  ok: boolean
  reasons: string[]
  needs_review: boolean
  review_question: string | null
}

export interface UploadResult {
  document_id: number
  // 'processed' (auto-filed, no human touch) is no longer possible as of
  // 2026-09-22 (DECISIONS #40) — every non-quarantined upload now needs
  // review, even a clean one.
  status: 'needs_review' | 'quarantined' | 'duplicate'
  classify?: ClassifyResult
  extract?: Record<string, ProvenanceValue | boolean> | null
  verify?: VerifyResult
  events?: unknown[]
  obligations_created?: number
  // reason (2026-09-22, DECISIONS #47): 'clean extraction' (verify.py's
  // literal string for a no-issues upload) vs a real reason — lets the
  // upload banner drop the amber badge for the routine case, same
  // distinction ReviewQueueCard already makes for review-queue cards.
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
  description: string | null
  bucket: string | null
  vendor_name: string | null
  // Document's own date (invoice/statutory issued_on, or EXIF for photos)
  // vs received_at's upload timestamp — null whenever the source document
  // has no discoverable date of its own (2026-09-22, DECISIONS #43).
  occurred_on: string | null
}

export interface Expectation {
  id: number
  doc_type: string
  label: string
  due_on: string | null
  status: string
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
  document_description: string | null
  document_bucket: string | null
  // Read-only here (not part of DocumentEditRequest) - decides whether
  // doc_type below renders as the fixed dropdown or the statutory lane's
  // free-text input; not itself editable from this card.
  document_lane: string | null
  document_doc_type: string | null
  document_vendor_name: string | null
  thread_id: string
  reason: string
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

/** Every ops call carries the session automatically — callers never pass
 * a token or a company_id by hand. */
function request<T>(path: string, init?: RequestInit): Promise<T> {
  return apiRequest<T>(path, { ...init, headers: { ...authHeaders(), ...init?.headers } })
}

export const opsApi = {
  health: () => request<{ status: string }>('/api/health'),

  uploadDocument: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<UploadResult>('/api/documents?source_channel=web', { method: 'POST', body: form })
  },

  listDocuments: () => request<DocumentRow[]>('/api/documents'),

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

  archiveDocument: (documentId: number) =>
    request<{ status: string }>(`/api/documents/${documentId}/archive`, { method: 'POST' }),

  // Real search (2026-09-22) — NOT the same thing as features/search/'s
  // mockSearchService: that one serves the logged-out marketing preview
  // with sample data and has no session to send. This is the actual,
  // tenant-scoped search over real documents, so it lives here with
  // everything else that needs the session.
  search: (q: string) => request<DocumentRow[]>(`/api/search?${new URLSearchParams({ q })}`),

  editDocument: (
    documentId: number,
    body: { description?: string; bucket?: Bucket; vendor_name?: string; doc_type?: string; filename?: string },
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
}
