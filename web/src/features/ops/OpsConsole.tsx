import { Check, Loader2, ShieldAlert, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import {
  opsApi,
  type Company,
  type DocumentRow,
  type Expectation,
  type Obligation,
  type ReviewItem,
  type TraceReport,
  type UploadResult,
} from './opsApi'

/** One field from a review_item.proposed_json blob — matches
 * app/models.py's Provenance[T], or a bare bool for injection_suspected. */
type ProposedField = { value: unknown; confidence: number } | boolean | null

function parseProposed(json: string): Record<string, ProposedField> {
  try {
    return JSON.parse(json) as Record<string, ProposedField>
  } catch {
    return {}
  }
}

function isProvenance(field: ProposedField | undefined): field is { value: unknown; confidence: number } {
  return typeof field === 'object' && field !== null && 'confidence' in field
}

function ReviewQueueCard({
  item,
  onResolved,
}: {
  item: ReviewItem
  onResolved: () => void
}) {
  const proposed = parseProposed(item.proposed_json)
  const fieldNames = Object.keys(proposed).filter((k) => k !== 'injection_suspected' && isProvenance(proposed[k]))

  const [edits, setEdits] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const name of fieldNames) {
      const field = proposed[name]
      initial[name] = isProvenance(field) && field.value !== null && field.value !== undefined ? String(field.value) : ''
    }
    return initial
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const originalValue = (name: string): string => {
    const field = proposed[name]
    return isProvenance(field) && field.value !== null && field.value !== undefined ? String(field.value) : ''
  }

  const resolve = async (action: 'confirm' | 'reject') => {
    setBusy(true)
    setError(null)
    try {
      const correctedFields: Record<string, unknown> = {}
      if (action === 'confirm') {
        for (const name of fieldNames) {
          if (edits[name] !== originalValue(name)) {
            const field = proposed[name]
            const isNumeric = isProvenance(field) && typeof field.value === 'number'
            correctedFields[name] = isNumeric ? Number(edits[name]) : edits[name]
          }
        }
      }
      await opsApi.resolveReview(item.id, item.thread_id, { action, corrected_fields: correctedFields })
      onResolved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <Card className="p-5" interactive={false}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-ink">{item.document_filename}</p>
          <p className="mt-1 text-[13px] text-amber-800">{item.question}</p>
        </div>
      </div>

      {fieldNames.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {fieldNames.map((name) => {
            const field = proposed[name]
            const confidence = isProvenance(field) ? field.confidence : null
            return (
              <label key={name} className="text-[12px] text-muted">
                {name}
                {confidence !== null && (
                  <span className={confidence < 0.6 ? 'ml-1 text-red-600' : 'ml-1 text-muted'}>
                    ({confidence.toFixed(2)})
                  </span>
                )}
                <input
                  value={edits[name]}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [name]: e.target.value }))}
                  className="mt-1 block h-9 w-full rounded-control border border-line px-2.5 text-[13px] text-ink outline-none focus:border-ink"
                />
              </label>
            )
          })}
        </div>
      )}

      {error && <p className="mt-3 text-[13px] text-red-700">{error}</p>}

      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={() => void resolve('confirm')} disabled={busy} icon={<Check size={14} />}>
          Accept{Object.keys(edits).some((n) => edits[n] !== originalValue(n)) ? ' with corrections' : ' as-is'}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => void resolve('reject')} disabled={busy} icon={<X size={14} />}>
          Reject
        </Button>
        {busy && <Loader2 size={16} className="animate-spin self-center text-muted" />}
      </div>
    </Card>
  )
}

const COMPANY_STORAGE_KEY = 'jagaos_ops_company_id'

const STATUS_TONE: Record<string, string> = {
  filed: 'text-sage-ink bg-sage/15',
  processed: 'text-sage-ink bg-sage/15',
  needs_review: 'text-amber-800 bg-amber-100',
  quarantined: 'text-red-800 bg-red-100',
  missing: 'text-muted bg-canvas',
  satisfied: 'text-sage-ink bg-sage/15',
  open: 'text-amber-800 bg-amber-100',
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-mono uppercase tracking-wide ${STATUS_TONE[status] ?? 'bg-canvas text-muted'}`}>
      {status}
    </span>
  )
}

/** Real end-to-end console against the actual backend (app/main.py) —
 * upload a document, see classify/extract/verify, gap analysis and
 * obligations, without going through Swagger. See docs/HANDOFF.md
 * "Backend status" for what this is wired to. Not part of the marketing
 * site; reached at /ops, no header tab. */
export function OpsConsole() {
  const [apiUp, setApiUp] = useState<boolean | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [existingCompanies, setExistingCompanies] = useState<Company[]>([])
  const [companyName, setCompanyName] = useState('Try Demo Pte Ltd')
  const [fyeMonth, setFyeMonth] = useState(12)
  const [fyeDay, setFyeDay] = useState(31)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [expectations, setExpectations] = useState<Expectation[]>([])
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([])
  const [lastUpload, setLastUpload] = useState<UploadResult | null>(null)
  const [trace, setTrace] = useState<{ documentId: number; report: TraceReport } | null>(null)

  useEffect(() => {
    opsApi
      .health()
      .then(() => setApiUp(true))
      .catch(() => setApiUp(false))
  }, [])

  const refresh = useCallback(async (companyId: number) => {
    const [docs, exps, obls, reviews] = await Promise.all([
      opsApi.listDocuments(companyId),
      opsApi.listExpectations(companyId),
      opsApi.listObligations(companyId),
      opsApi.listReviewItems(companyId),
    ])
    setDocuments(docs)
    setExpectations(exps)
    setObligations(obls)
    setReviewItems(reviews)
  }, [])

  useEffect(() => {
    opsApi
      .listCompanies()
      .then(async (companies) => {
        setExistingCompanies(companies)
        const savedId = Number(localStorage.getItem(COMPANY_STORAGE_KEY))
        const saved = companies.find((c) => c.id === savedId)
        if (saved) {
          setCompany(saved)
          await refresh(saved.id)
        }
      })
      .catch(() => {
        // apiUp check below already surfaces "backend unreachable"
      })
  }, [refresh])

  const selectCompany = async (selected: Company) => {
    setCompany(selected)
    localStorage.setItem(COMPANY_STORAGE_KEY, String(selected.id))
    setError(null)
    try {
      await refresh(selected.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const createCompany = async () => {
    setBusy(true)
    setError(null)
    try {
      const created = await opsApi.createCompany({ name: companyName, fye_month: fyeMonth, fye_day: fyeDay })
      setCompany(created)
      setExistingCompanies((prev) => [...prev, created])
      localStorage.setItem(COMPANY_STORAGE_KEY, String(created.id))
      await refresh(created.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onUpload = async (file: File) => {
    if (!company) return
    setBusy(true)
    setError(null)
    try {
      const result = await opsApi.uploadDocument(company.id, file)
      setLastUpload(result)
      await refresh(company.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const viewTrace = async (documentId: number) => {
    const report = await opsApi.getTrace(documentId)
    setTrace({ documentId, report })
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-[13px] text-muted">
        <span className={`h-2 w-2 rounded-full ${apiUp ? 'bg-sage' : 'bg-red-500'}`} aria-hidden="true" />
        {apiUp === null && 'Checking backend…'}
        {apiUp === true && `Backend reachable at ${import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'}`}
        {apiUp === false && 'Backend unreachable — start it with `uvicorn app.main:app --reload` in app/'}
      </div>

      {error && (
        <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      {!company ? (
        <Card className="p-6" interactive={false}>
          {existingCompanies.length > 0 && (
            <div className="mb-6 border-b border-line pb-6">
              <h2 className="text-sm font-medium text-ink">Use an existing company</h2>
              <p className="mt-1 text-[13px] text-muted">
                Already seeded — pick one instead of starting from scratch.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {existingCompanies.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => void selectCompany(c)}
                    className="rounded-control border border-line px-3.5 py-2 text-[13px] text-ink hover:border-ink/40"
                  >
                    {c.name} <span className="text-muted">#{c.id}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <h2 className="text-sm font-medium text-ink">Create a new company</h2>
          <p className="mt-1 text-[13px] text-muted">
            Persists in the database — pick it from the list above next time instead of recreating it.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-[13px] text-muted">
              Name
              <input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="mt-1 block h-10 w-64 rounded-control border border-line px-3 text-sm text-ink outline-none focus:border-ink"
              />
            </label>
            <label className="text-[13px] text-muted">
              FYE month
              <input
                type="number"
                min={1}
                max={12}
                value={fyeMonth}
                onChange={(e) => setFyeMonth(Number(e.target.value))}
                className="mt-1 block h-10 w-20 rounded-control border border-line px-3 text-sm text-ink outline-none focus:border-ink"
              />
            </label>
            <label className="text-[13px] text-muted">
              FYE day
              <input
                type="number"
                min={1}
                max={31}
                value={fyeDay}
                onChange={(e) => setFyeDay(Number(e.target.value))}
                className="mt-1 block h-10 w-20 rounded-control border border-line px-3 text-sm text-ink outline-none focus:border-ink"
              />
            </label>
            <Button onClick={() => void createCompany()} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : null}
              Create company
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <Card className="p-6" interactive={false}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium text-ink">{company.name}</h2>
                <p className="text-[13px] text-muted">Company #{company.id}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  localStorage.removeItem(COMPANY_STORAGE_KEY)
                  setCompany(null)
                  setDocuments([])
                  setExpectations([])
                  setObligations([])
                  setReviewItems([])
                }}
              >
                Switch company
              </Button>
            </div>

            <label className="mt-5 flex h-24 cursor-pointer items-center justify-center gap-2 rounded-card border border-dashed border-line text-sm text-muted hover:border-ink/40">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {busy ? 'Uploading…' : 'Click to upload a PDF or image'}
              <input
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void onUpload(file)
                  e.target.value = ''
                }}
              />
            </label>

            {lastUpload && (
              <div className="mt-4 rounded-card border border-line bg-canvas p-4 text-[13px]">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">Last upload result:</span>
                  <StatusPill status={lastUpload.status} />
                </div>
                {lastUpload.classify && (
                  <p className="mt-1 text-muted">
                    {lastUpload.classify.lane} / {lastUpload.classify.doc_type} · confidence {lastUpload.classify.confidence.toFixed(2)}
                    {lastUpload.classify.injection_suspected && (
                      <span className="ml-2 inline-flex items-center gap-1 text-red-700">
                        <ShieldAlert size={12} /> injection suspected
                      </span>
                    )}
                  </p>
                )}
                {lastUpload.status === 'needs_review' && lastUpload.review?.question && (
                  <p className="mt-1 text-amber-800">Review: {lastUpload.review.question}</p>
                )}
                {lastUpload.status === 'quarantined' && (
                  <p className="mt-1 text-red-700">Quarantined by the injection guardrail — obligation table untouched.</p>
                )}
              </div>
            )}
          </Card>

          {reviewItems.length > 0 && (
            <section>
              <h2 className="mb-3 text-[11px] font-mono uppercase tracking-wide text-amber-800">
                Needs your review ({reviewItems.length})
              </h2>
              <div className="space-y-3">
                {reviewItems.map((item) => (
                  <ReviewQueueCard
                    key={item.id}
                    item={item}
                    onResolved={() => {
                      if (company) void refresh(company.id)
                    }}
                  />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-[11px] font-mono uppercase tracking-wide text-muted">
              Documents ({documents.length})
            </h2>
            <Card className="overflow-hidden p-0" interactive={false}>
              {documents.length === 0 ? (
                <p className="p-6 text-sm text-muted">No documents uploaded yet.</p>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <tbody>
                    {documents.map((doc) => (
                      <tr key={doc.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5 text-ink">{doc.filename}</td>
                        <td className="px-4 py-2.5 text-muted">{doc.lane ?? '—'} / {doc.doc_type ?? '—'}</td>
                        <td className="px-4 py-2.5"><StatusPill status={doc.status} /></td>
                        <td className="px-4 py-2.5 text-right">
                          <button
                            onClick={() => void viewTrace(doc.id)}
                            className="text-[12px] font-mono uppercase tracking-wide text-muted hover:text-ink"
                          >
                            trace →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </section>

          {trace && (
            <section>
              <h2 className="mb-3 text-[11px] font-mono uppercase tracking-wide text-muted">
                Trace — document #{trace.documentId} · total ${trace.report.total_cost_usd.toFixed(4)}
              </h2>
              <Card className="overflow-hidden p-0" interactive={false}>
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-canvas text-muted">
                    <tr>
                      <th className="px-4 py-2 font-normal">Node</th>
                      <th className="px-4 py-2 font-normal">Model</th>
                      <th className="px-4 py-2 font-normal">Tokens in/out</th>
                      <th className="px-4 py-2 font-normal">Cost</th>
                      <th className="px-4 py-2 font-normal">Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trace.report.nodes.map((node, i) => (
                      <tr key={i} className="border-t border-line">
                        <td className="px-4 py-2 text-ink">{node.node}</td>
                        <td className="px-4 py-2 text-muted">{node.model ?? '—'}</td>
                        <td className="px-4 py-2 text-muted">
                          {node.input_tokens ?? '—'} / {node.output_tokens ?? '—'}
                        </td>
                        <td className="px-4 py-2 text-muted">{node.cost_usd ? `$${node.cost_usd.toFixed(5)}` : '—'}</td>
                        <td className="px-4 py-2 text-muted">{node.decision ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </section>
          )}

          <section>
            <h2 className="mb-3 text-[11px] font-mono uppercase tracking-wide text-muted">
              Gap analysis — {expectations.filter((e) => e.status === 'satisfied').length} of {expectations.length} held
            </h2>
            <Card className="overflow-hidden p-0" interactive={false}>
              {expectations.length === 0 ? (
                <p className="p-6 text-sm text-muted">No expectations yet — upload a statutory document that reads as a company event (incorporation, corp sec change).</p>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <tbody>
                    {expectations.map((exp) => (
                      <tr key={exp.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-2.5 text-ink">{exp.label}</td>
                        <td className="px-4 py-2.5"><StatusPill status={exp.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </section>

          <section>
            <h2 className="mb-3 text-[11px] font-mono uppercase tracking-wide text-muted">
              Obligations ({obligations.length})
            </h2>
            <Card className="overflow-hidden p-0" interactive={false}>
              {obligations.length === 0 ? (
                <p className="p-6 text-sm text-muted">No obligations derived yet.</p>
              ) : (
                <table className="w-full text-left text-[13px]">
                  <tbody>
                    {obligations.map((ob) => (
                      <tr key={ob.id} className="border-b border-line last:border-0 align-top">
                        <td className="px-4 py-2.5 text-ink">
                          {ob.label}
                          <Badge tone="neutral" className="ml-2">{ob.risk}</Badge>
                        </td>
                        <td className="px-4 py-2.5 text-muted">{ob.due_on}</td>
                        <td className="px-4 py-2.5"><StatusPill status={ob.status} /></td>
                        <td className="max-w-xs px-4 py-2.5 text-[12px] text-muted">{ob.citation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </section>
        </>
      )}
    </div>
  )
}
