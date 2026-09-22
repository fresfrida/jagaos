import { Check, Loader2, ShieldAlert, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { roleAtLeast } from '../auth/authApi'
import { useAuth } from '../auth/AuthContext'
import { navigate } from '../../router/navigate'
import { routeHref } from '../../router/routes'
import {
  opsApi,
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
  canResolve,
  onResolved,
}: {
  item: ReviewItem
  canResolve: boolean
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
                  disabled={!canResolve}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [name]: e.target.value }))}
                  className="mt-1 block h-9 w-full rounded-control border border-line px-2.5 text-[13px] text-ink outline-none focus:border-ink disabled:bg-canvas disabled:text-muted"
                />
              </label>
            )
          })}
        </div>
      )}

      {error && <p className="mt-3 text-[13px] text-red-700">{error}</p>}

      {canResolve ? (
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={() => void resolve('confirm')} disabled={busy} icon={<Check size={14} />}>
            Accept{Object.keys(edits).some((n) => edits[n] !== originalValue(n)) ? ' with corrections' : ' as-is'}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void resolve('reject')} disabled={busy} icon={<X size={14} />}>
            Reject
          </Button>
          {busy && <Loader2 size={16} className="animate-spin self-center text-muted" />}
        </div>
      ) : (
        <p className="mt-4 text-[12px] text-muted">Only an admin or owner can resolve this.</p>
      )}
    </Card>
  )
}

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

/** The logged-in app: add a document, watch the agent process it, confirm
 * anything flagged, see the gap analysis and obligations it produces.
 * Session-scoped (features/auth) — company_id is never passed by hand,
 * the backend derives it from the bearer token. What renders (the upload
 * box, the Accept/Reject buttons) depends on role, not on hiding data —
 * the backend rejects the write either way (app/auth.py's require_role);
 * this only avoids offering a control that would 403. */
export function OpsConsole() {
  const { status, user, company, role } = useAuth()
  const [apiUp, setApiUp] = useState<boolean | null>(null)
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

  useEffect(() => {
    if (status === 'signed-out') navigate(routeHref('login'))
  }, [status])

  const refresh = useCallback(async () => {
    const [docs, exps, obls, reviews] = await Promise.all([
      opsApi.listDocuments(),
      opsApi.listExpectations(),
      opsApi.listObligations(),
      opsApi.listReviewItems(),
    ])
    setDocuments(docs)
    setExpectations(exps)
    setObligations(obls)
    setReviewItems(reviews)
  }, [])

  useEffect(() => {
    if (status !== 'signed-in') return
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [status, refresh])

  const onUpload = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const result = await opsApi.uploadDocument(file)
      setLastUpload(result)
      await refresh()
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

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted">
        <Loader2 size={16} className="animate-spin" /> Checking your session…
      </div>
    )
  }

  if (status === 'signed-out') {
    // useEffect above is already redirecting to /login; this is what
    // renders for the one tick before that navigation completes.
    return <p className="py-16 text-sm text-muted">Redirecting to log in…</p>
  }

  const canUpload = role !== null && roleAtLeast(role, 'user')
  const canResolve = role !== null && roleAtLeast(role, 'admin')

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
        <span className="inline-flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${apiUp ? 'bg-sage' : 'bg-red-500'}`} aria-hidden="true" />
          {apiUp === null && 'Checking backend…'}
          {apiUp === true && 'Backend reachable'}
          {apiUp === false && 'Backend unreachable — start it with `uvicorn app.main:app --reload` in app/'}
        </span>
        {company && user && (
          <span>
            {company.name} · {user.email} · <Badge mono>{role}</Badge>
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-card border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </div>
      )}

      <Card className="p-6" interactive={false}>
        {canUpload ? (
          <label className="flex h-24 cursor-pointer items-center justify-center gap-2 rounded-card border border-dashed border-line text-sm text-muted hover:border-ink/40">
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
        ) : (
          <p className="flex h-24 items-center justify-center rounded-card border border-dashed border-line text-sm text-muted">
            Viewers can't upload documents — ask an admin or owner.
          </p>
        )}

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
            Needs review ({reviewItems.length})
          </h2>
          <div className="space-y-3">
            {reviewItems.map((item) => (
              <ReviewQueueCard
                key={item.id}
                item={item}
                canResolve={canResolve}
                onResolved={() => void refresh()}
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
    </div>
  )
}
