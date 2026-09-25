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
 * Business profile (round 16, DECISIONS #90): the first row is the company's
 * business profile (features/company/BusinessProfileSection): upload it, see its
 * thumbnail, open it in the lightbox. Once a person has confirmed what was read in
 * the review queue, "Fill in the form" shows every change (field, now, from the
 * profile) in a bottom sheet first; applying fills the FORM and marks what changed,
 * and nothing is saved until the owner presses Save. (Round 12's Company Files
 * card link and its ?prefill= address are gone.)
 *
 * Compliance checklist (round 21, A2, DECISIONS #101): the full checklist is a section under the form; the Calendar
 * keeps only a one-line count that links here for admin and owner.
 *
 * Purge requests (round 21, A5, DECISIONS #101): the documents the owner asked to have purged and the team has not yet removed. They
 * were a section under the checklist; since round 3 (item 9c, DECISIONS #121) they are a page of their own, and this page only links to it
 * (owner only). */

import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { useAuth } from '../features/auth/AuthContext'
import { RequireSession } from '../features/auth/RequireSession'
import { authApi, roleAtLeast } from '../features/auth/authApi'
import { BusinessProfileSection } from '../features/company/BusinessProfileSection'
import { ComplianceChecklistSection } from '../features/company/ComplianceChecklistSection'
import {
  applyPrefill, backendHasIdentityFields, formFromCompany, prefillChanges, toUpdate, type CompanyForm, type CompanyFormField,
} from '../features/company/companyForm'
import { PrefillConfirmSheet } from '../features/company/PrefillConfirmSheet'
import { useBusinessProfile } from '../features/company/useBusinessProfile'
import { useCompanyProfilePrefill } from '../features/company/useCompanyProfilePrefill'
import { FIELD_CLASS } from '../features/ops/opsShared'
import { cn } from '../lib/cn'
import { middleEllipsis } from '../lib/filename'
import { navigate } from '../router/navigate'
import { routeHref } from '../router/routes'
import { Link } from '../router/Link'

const BLANK_FORM: CompanyForm = { name: '', fyeMonth: 12, fyeDay: 31, uen: '', gstRegistered: false, registeredAddress: '' }
// What a field a pre-fill just changed looks like — the owner should see what the document is proposing.
const PREFILLED_CLASS = 'border-sage ring-1 ring-sage'

function CompanySettingsContent() {
  const { t, i18n } = useTranslation()
  const { role, company, refreshCompany } = useAuth()
  const canEdit = role === 'owner'
  const canView = role !== null && roleAtLeast(role, 'admin')
  // Against a backend that predates the identity fields, the form is the
  // name/year-end one it always was (see backendHasIdentityFields).
  const showIdentityFields = backendHasIdentityFields(company)

  const [form, setForm] = useState<CompanyForm>(() => (company ? formFromCompany(company) : BLANK_FORM))
  const [prefilled, setPrefilled] = useState<CompanyFormField[]>([])
  // Which business-profile document the owner asked to fill the form from (drives the
  // fetch and the confirmation sheet), and, once they confirmed, which file it came from.
  const [prefillDocumentId, setPrefillDocumentId] = useState<number | null>(null)
  const [appliedFrom, setAppliedFrom] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const prefillState = useCompanyProfilePrefill(prefillDocumentId, canEdit)
  const businessProfile = useBusinessProfile({ enabled: canEdit, language: i18n.language })
  // What the confirmation sheet lists: computed from the SAVED company, the same base
  // applyPrefill lays the profile over, so the sheet and the apply always agree.
  const pendingChanges = useMemo(
    () => (prefillState.status === 'ready' && company ? prefillChanges(formFromCompany(company), prefillState.prefill) : []),
    [prefillState, company],
  )

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
    setAppliedFrom(null)
  }, [company])

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

  // Confirmed in the sheet: lay the profile over the SAVED company (not over whatever
  // is typed), so applying is idempotent and Discard is just "reset".
  const applyConfirmedPrefill = () => {
    if (prefillState.status !== 'ready' || !company) return
    const result = applyPrefill(formFromCompany(company), prefillState.prefill)
    setForm(result.form)
    setPrefilled(result.changed)
    setAppliedFrom(prefillState.prefill.filename)
    setPrefillDocumentId(null)
  }

  const discardPrefill = () => {
    if (company) setForm(formFromCompany(company))
    setPrefilled([])
    setAppliedFrom(null)
  }

  const save = async () => {
    if (!company) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await authApi.updateCompany(company.id, toUpdate(form, showIdentityFields))
      await refreshCompany()
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    // ONE width and one centre for the whole page (DECISIONS #111). The profile card was 448px and the checklist and the purge
    // requests 672px, all left-aligned; the three sections now share this column and none sets its own width.
    <div className="mx-auto w-full max-w-2xl" data-testid="settings-column">
    <Card className="p-6" interactive={false}>
      {canEdit && (
        <BusinessProfileSection
          profile={businessProfile}
          onFill={setPrefillDocumentId}
          fillBusy={prefillState.status === 'loading'}
        />
      )}

      {prefillState.status === 'loading' && (
        <p className="mb-4 text-[13px] text-muted" role="status">{t('companySettings.prefill.loading')}</p>
      )}
      {prefillState.status === 'failed' && (
        <p className="mb-4 text-[13px] text-red-700" role="alert">{t('companySettings.prefill.failed')}</p>
      )}
      {appliedFrom !== null && (
        <div className="mb-4 rounded-control border border-sage bg-canvas p-3 text-[13px] text-ink" role="status">
          <p>{t('companySettings.prefill.banner', { filename: middleEllipsis(appliedFrom, 36) })}</p>
          <button type="button" onClick={discardPrefill} className="mt-1.5 underline hover:text-muted">
            {t('companySettings.prefill.discard')}
          </button>
        </div>
      )}
      <PrefillConfirmSheet
        open={prefillState.status === 'ready'}
        changes={pendingChanges}
        onApply={applyConfirmedPrefill}
        onCancel={() => setPrefillDocumentId(null)}
      />

      <label className="block text-[14px] text-muted">
        {t('companySettings.nameLabel')}
        <input
          value={form.name}
          disabled={!canEdit}
          onChange={(e) => set('name', e.target.value)}
          className={fieldClass('name')}
        />
      </label>

      {showIdentityFields && (
        <label className="mt-3 block text-[14px] text-muted">
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
        <label className="text-[14px] text-muted">
          {t('companySettings.fyeMonthLabel')}
          <input
            type="number" min={1} max={12}
            value={form.fyeMonth}
            disabled={!canEdit}
            onChange={(e) => set('fyeMonth', Number(e.target.value))}
            className={fieldClass('fyeMonth', 'w-20')}
          />
        </label>
        <label className="text-[14px] text-muted">
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
          <label className="mt-3 block text-[14px] text-muted">
            {t('companySettings.addressLabel')}
            <textarea
              rows={2}
              value={form.registeredAddress}
              disabled={!canEdit}
              onChange={(e) => set('registeredAddress', e.target.value)}
              className={cn(
                'mt-1 block w-full rounded-control border border-line bg-white px-2.5 py-1.5 text-[14px] text-ink outline-none focus:border-ink disabled:bg-canvas disabled:text-muted',
                prefilled.includes('registeredAddress') && PREFILLED_CLASS,
              )}
            />
          </label>

          <label
            className={cn(
              'mt-3 flex items-center gap-2 rounded-control text-[14px] text-ink',
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

      {!canEdit && <p className="mt-3 text-[13px] text-muted">{t('companySettings.readOnlyNotice')}</p>}
      {error && <p className="mt-3 text-[13px] text-red-700">{error}</p>}
      {saved && <p className="mt-3 text-[13px] text-sage-ink">{t('companySettings.saved')}</p>}

      {canEdit && (
        <Button size="sm" className="mt-4" onClick={() => void save()} disabled={busy}>
          {t('common.buttons.save')}
        </Button>
      )}
    </Card>

    {/* The checklist draws its own heading ("Compliance checklist: 2 of 6 held"), so this section is only named, not headed twice. */}
    <section className="mt-10" aria-label={t('companySettings.checklist.heading')}>
      <ComplianceChecklistSection enabled={canView} />
    </section>

    {canEdit && (
      <Link
        href={routeHref('purge-requests')}
        className="mt-10 flex items-center justify-between gap-3 rounded-card border border-line bg-white px-4 py-3 transition-colors hover:border-ink/40"
      >
        <span className="min-w-0">
          <span className="block text-[14px] font-medium text-ink">{t('companySettings.purgeRequests.title')}</span>
          <span className="block text-[13px] text-muted">{t('companySettings.purgeRequests.description')}</span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden="true" />
      </Link>
    )}
    </div>
  )
}

export function CompanySettingsPage() {
  return (
    <RequireSession>
      <CompanySettingsContent />
    </RequireSession>
  )
}
