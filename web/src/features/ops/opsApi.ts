/** Thin fetch wrapper over the real backend (app/main.py). Separate from
 * features/search/searchService.ts on purpose: that boundary is for the
 * marketing preview's mock "memories" model, this one talks to the actual
 * ARCHITECTURE.md pipeline (documents/expectations/obligations/trace).
 * Base URL: VITE_API_BASE_URL (web/.env, never committed). */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export interface Company {
  id: number
  name: string
}

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, init)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status} ${res.statusText}: ${body}`)
  }
  return res.json() as Promise<T>
}

export const opsApi = {
  health: () => request<{ status: string }>('/api/health'),

  listCompanies: () => request<Company[]>('/api/companies'),

  createCompany: (params: { name: string; fye_month: number; fye_day: number }) =>
    request<Company>(
      `/api/companies?${new URLSearchParams({
        name: params.name,
        fye_month: String(params.fye_month),
        fye_day: String(params.fye_day),
      })}`,
      { method: 'POST' },
    ),

  uploadDocument: (companyId: number, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<UploadResult>(
      `/api/documents?${new URLSearchParams({ company_id: String(companyId), source_channel: 'web' })}`,
      { method: 'POST', body: form },
    )
  },

  listDocuments: (companyId: number) =>
    request<DocumentRow[]>(`/api/documents?${new URLSearchParams({ company_id: String(companyId) })}`),

  listExpectations: (companyId: number) =>
    request<Expectation[]>(`/api/expectations?${new URLSearchParams({ company_id: String(companyId) })}`),

  listObligations: (companyId: number) =>
    request<Obligation[]>(`/api/obligations?${new URLSearchParams({ company_id: String(companyId) })}`),

  listReviewItems: (companyId: number) =>
    request<ReviewItem[]>(`/api/review?${new URLSearchParams({ company_id: String(companyId) })}`),

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
