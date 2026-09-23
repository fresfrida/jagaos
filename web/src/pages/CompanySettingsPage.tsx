/** Company settings — /company-settings (2026-09-23, role/permission
 * work). The company row was write-once at signup until now
 * (`app/main.py::edit_company`, `PATCH /api/companies/{id}`, owner-only
 * server-side — `require_role("owner")`). Scoped to `name`/`fye_month`/
 * `fye_day`, the fields the signup form itself already collects.
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
 * for this caller's role. */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { useAuth } from '../features/auth/AuthContext'
import { RequireSession } from '../features/auth/RequireSession'
import { authApi, roleAtLeast } from '../features/auth/authApi'
import { FIELD_CLASS } from '../features/ops/opsShared'
import { cn } from '../lib/cn'
import { navigate } from '../router/navigate'
import { routeHref } from '../router/routes'

function CompanySettingsContent() {
  const { t } = useTranslation()
  const { role, company, refreshCompany } = useAuth()
  const canEdit = role === 'owner'
  const canView = role !== null && roleAtLeast(role, 'admin')

  const [name, setName] = useState('')
  const [fyeMonth, setFyeMonth] = useState(12)
  const [fyeDay, setFyeDay] = useState(31)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (role !== null && !canView) navigate(routeHref('calendar'))
  }, [role, canView])

  useEffect(() => {
    if (!company) return
    setName(company.name)
    setFyeMonth(company.fye_month)
    setFyeDay(company.fye_day)
  }, [company])

  if (role !== null && !canView) {
    return <p className="py-16 text-sm text-muted">{t('ops.session.redirecting')}</p>
  }

  const save = async () => {
    if (!company) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await authApi.updateCompany(company.id, { name, fye_month: fyeMonth, fye_day: fyeDay })
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
      <label className="block text-[13px] text-muted">
        {t('companySettings.nameLabel')}
        <input
          value={name}
          disabled={!canEdit}
          onChange={(e) => setName(e.target.value)}
          className={cn(FIELD_CLASS, 'mt-1')}
        />
      </label>

      <div className="mt-3 flex gap-3">
        <label className="text-[13px] text-muted">
          {t('companySettings.fyeMonthLabel')}
          <input
            type="number" min={1} max={12}
            value={fyeMonth}
            disabled={!canEdit}
            onChange={(e) => setFyeMonth(Number(e.target.value))}
            className={cn(FIELD_CLASS, 'mt-1 w-20')}
          />
        </label>
        <label className="text-[13px] text-muted">
          {t('companySettings.fyeDayLabel')}
          <input
            type="number" min={1} max={31}
            value={fyeDay}
            disabled={!canEdit}
            onChange={(e) => setFyeDay(Number(e.target.value))}
            className={cn(FIELD_CLASS, 'mt-1 w-20')}
          />
        </label>
      </div>

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
