/** Company settings — /company-settings (2026-09-23, role/permission
 * work). The company row was write-once at signup until now
 * (`app/main.py::edit_company`, `PATCH /api/companies/{id}`, owner-only
 * server-side — `require_role("owner")`). Started as `name`/`fye_month`/
 * `fye_day`, the fields the signup form itself already collects; round 12
 * (2026-09-24, DECISIONS #79) added UEN, GST registered and the registered
 * address — the identity fields an ACRA business profile can pre-fill.
 *
 * Reachability, resolving a real contradiction in the original ask (see
 * docs/DECISIONS.md for the full write-up): the nav entry (`Header.tsx`)
 * is visible to owner + admin — admin sees every field disabled (`cn`'d
 * onto the shared `FIELD_CLASS` `disabled:` styling, same pattern every
 * other read-only field in this app already uses), matching "admin sees
 * it read-only." user/viewer get no nav entry at all, and a direct hit
 * redirects to /calendar rather than a 404 — this app has no
 * 404-for-insufficient-role convention anywhere (`RequireSession`
 * redirects to /login for no session, the same soft pattern), so a 404
 * here would be the one exception for a route that does exist, just not
 * for this caller's role.
 *
 * Pre-fill (round 12): arriving with ?prefill=<document id> (the Company
 * Files card's action on a confirmed ACRA business profile) lays that
 * document's extracted values over the form and marks what changed. It only
 * fills the form — nothing is saved until the owner presses Save. */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { useAuth } from '../features/auth/AuthContext'
import { RequireSession } from '../features/auth/RequireSession'
import { authApi, roleAtLeast } from '../features/auth/authApi'
import {
  applyPrefill, backendHasIdentityFields, formFromCompany, toUpdate, type CompanyForm, type CompanyFormField,
} from '../features/company/companyForm'
import { prefillDocumentIdFromQuery, useCompanyProfilePrefill } from '../features/company/useCompanyProfilePrefill'
import { FIELD_CLASS } from '../features/ops/opsShared'
import { cn } from '../lib/cn'
import { navigate } from '../router/navigate'
import { routeHref } from '../router/routes'

const BLANK_FORM: CompanyForm = { name: '', fyeMonth: 12, fyeDay: 31, uen: '', gstRegistered: false, registeredAddress: '' }
// What a field a pre-fill just changed looks like — the owner should see what the document is proposing.
const PREFILLED_CLASS = 'border-sage ring-1 ring-sage'

function CompanySettingsContent() {
  const { t } = useTranslation()
  const { role, company, refreshCompany } = useAuth()
  const canEdit = role === 'owner'
  const canView = role !== null && roleAtLeast(role, 'admin')
  // Against a backend that predates the identity fields, the form is the
  // name/year-end one it always was (see backendHasIdentityFields).
  const showIdentityFields = backendHasIdentityFields(company)

  const [form, setForm] = useState<CompanyForm>(() => (company ? formFromCompany(company) : BLANK_FORM))
  const [prefilled, setPrefilled] = useState<CompanyFormField[]>([])
  const [prefillDocumentId, setPrefillDocumentId] = useState<number | null>(() =>
    prefillDocumentIdFromQuery(window.location.search),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const prefillState = useCompanyProfilePrefill(prefillDocumentId, canEdit)

  useEffect(() => {
    if (role !== null && !canView) navigate(routeHref('calendar'))
  }, [role, canView])

  // The saved company is the source of truth for the form; this also runs
  // after a save (refreshCompany changes `company`), which is what clears a
  // pre-fill's highlights once its values are the saved ones.
  useEffect(() => {
    if (!company) return
    setForm(formFromCompany(company))
    setPrefilled([])
  }, [company])

  // A pre-fill lays its values over the SAVED company (not over whatever is
  // typed), so applying it is idempotent and Discard is just "reset".
  useEffect(() => {
    if (prefillState.status !== 'ready' || !company) return
    const result = applyPrefill(formFromCompany(company), prefillState.prefill)
    setForm(result.form)
    setPrefilled(result.changed)
  }, [prefillState, company])

  if (role !== null && !canView) {
    return <p className="py-16 text-sm text-muted">{t('ops.session.redirecting')}</p>
  }

  const set = <K extends CompanyFormField>(field: K, value: CompanyForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    setPrefilled((prev) => prev.filter((f) => f !== field)) // an edit is the owner's own now
    setSaved(false)
  }
  const fieldClass = (field: CompanyFormField, extra?: string) =>
    cn(FIELD_CLASS, 'mt-1', extra, prefilled.includes(field) && PREFILLED_CLASS)

  const clearPrefillFromUrl = () => {
    setPrefillDocumentId(null)
    window.history.replaceState(null, '', routeHref('company-settings'))
  }

  const discardPrefill = () => {
    clearPrefillFromUrl()
    if (company) setForm(formFromCompany(company))
    setPrefilled([])
  }

  const save = async () => {
    if (!company) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await authApi.updateCompany(company.id, toUpdate(form, showIdentityFields))
      clearPrefillFromUrl()
      await refreshCompany()
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="max-w-md p-6" interactive={false}>
      {prefillState.status === 'loading' && (
        <p className="mb-4 text-[12px] text-muted" role="status">{t('companySettings.prefill.loading')}</p>
      )}
      {prefillState.status === 'failed' && (
        <p className="mb-4 text-[12px] text-red-700" role="alert">{t('companySettings.prefill.failed')}</p>
      )}
      {prefillState.status === 'ready' && (
        <div className="mb-4 rounded-control border border-sage bg-canvas p-3 text-[12px] text-ink" role="status">
          <p>{t('companySettings.prefill.banner', { filename: prefillState.prefill.filename })}</p>
          <button type="button" onClick={discardPrefill} className="mt-1.5 underline hover:text-muted">
            {t('companySettings.prefill.discard')}
          </button>
        </div>
      )}

      <label className="block text-[13px] text-muted">
        {t('companySettings.nameLabel')}
        <input
          value={form.name}
          disabled={!canEdit}
          onChange={(e) => set('name', e.target.value)}
          className={fieldClass('name')}
        />
      </label>

      {showIdentityFields && (
        <label className="mt-3 block text-[13px] text-muted">
          {t('companySettings.uenLabel')}
          <input
            value={form.uen}
            disabled={!canEdit}
            onChange={(e) => set('uen', e.target.value)}
            className={fieldClass('uen')}
          />
        </label>
      )}

      <div className="mt-3 flex gap-3">
        <label className="text-[13px] text-muted">
          {t('companySettings.fyeMonthLabel')}
          <input
            type="number" min={1} max={12}
            value={form.fyeMonth}
            disabled={!canEdit}
            onChange={(e) => set('fyeMonth', Number(e.target.value))}
            className={fieldClass('fyeMonth', 'w-20')}
          />
        </label>
        <label className="text-[13px] text-muted">
          {t('companySettings.fyeDayLabel')}
          <input
            type="number" min={1} max={31}
            value={form.fyeDay}
            disabled={!canEdit}
            onChange={(e) => set('fyeDay', Number(e.target.value))}
            className={fieldClass('fyeDay', 'w-20')}
          />
        </label>
      </div>

      {showIdentityFields && (
        <>
          <label className="mt-3 block text-[13px] text-muted">
            {t('companySettings.addressLabel')}
            <textarea
              rows={2}
              value={form.registeredAddress}
              disabled={!canEdit}
              onChange={(e) => set('registeredAddress', e.target.value)}
              className={cn(
                'mt-1 block w-full rounded-control border border-line bg-white px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink disabled:bg-canvas disabled:text-muted',
                prefilled.includes('registeredAddress') && PREFILLED_CLASS,
              )}
            />
          </label>

          <label
            className={cn(
              'mt-3 flex items-center gap-2 rounded-control text-[13px] text-ink',
              prefilled.includes('gstRegistered') && cn(PREFILLED_CLASS, 'px-2 py-1'),
            )}
          >
            <input
              type="checkbox"
              checked={form.gstRegistered}
              disabled={!canEdit}
              onChange={(e) => set('gstRegistered', e.target.checked)}
              className="h-4 w-4"
            />
            {t('companySettings.gstLabel')}
          </label>
        </>
      )}

      {!canEdit && <p className="mt-3 text-[12px] text-muted">{t('companySettings.readOnlyNotice')}</p>}
      {error && <p className="mt-3 text-[12px] text-red-700">{error}</p>}
      {saved && <p className="mt-3 text-[12px] text-sage-ink">{t('companySettings.saved')}</p>}

      {canEdit && (
        <Button size="sm" className="mt-4" onClick={() => void save()} disabled={busy}>
          {t('common.buttons.save')}
        </Button>
      )}
    </Card>
  )
}

export function CompanySettingsPage() {
  return (
    <RequireSession>
      <CompanySettingsContent />
    </RequireSession>
  )
}
