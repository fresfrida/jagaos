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

import { apiRequest } from '../../lib/apiClient'
import { authHeaders } from '../auth/authApi'

export interface ClassifyResult {
  lane: string
  doc_type: string
  confidence: number
  injection_suspected: boolean
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
  status: 'processed' | 'needs_review' | 'quarantined' | 'duplicate'
  classify?: ClassifyResult
  extract?: Record<string, ProvenanceValue | boolean> | null
  verify?: VerifyResult
  events?: unknown[]
  obligations_created?: number
  review?: { question: string | null } | null
  review_item_id?: number | null
}

export interface DocumentRow {
  id: number
  filename: string
  lane: string | null
  doc_type: string | null
  status: string
  received_at: string
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
}
