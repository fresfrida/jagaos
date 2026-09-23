import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { Container } from '../components/ui/Container'
import { useAuth } from '../features/auth/AuthContext'
import { navigate } from '../router/navigate'
import { routeHref } from '../router/routes'

/** Placeholder for real magic-link email (no email-sending is set up yet —
 * see app/auth.py's docstring). Same session/role model either way; swap
 * this form for a "check your email" step later without touching anything
 * downstream. */
export function LoginPage() {
  const { t } = useTranslation()
  const { status, login, error } = useAuth()
  const [email, setEmail] = useState('')
  const [isNewCompany, setIsNewCompany] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [fyeMonth, setFyeMonth] = useState(12)
  const [fyeDay, setFyeDay] = useState(31)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (status === 'signed-in') navigate(routeHref('ops'))
  }, [status])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await login(
        isNewCompany
          ? { email, company_name: companyName, fye_month: fyeMonth, fye_day: fyeDay }
          : { email },
      )
      navigate(routeHref('ops'))
    } catch {
      // error state already surfaced by useAuth()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Container className="flex min-h-[calc(100svh-65px)] items-center justify-center py-16">
      <Card className="w-full max-w-sm p-6" interactive={false}>
        <h1 className="text-xl font-semibold text-ink">{t('auth.login.title')}</h1>
        <p className="mt-1 text-[13px] text-muted">
          {t('auth.login.subtitle')}
        </p>

        <form onSubmit={(e) => void submit(e)} className="mt-5 space-y-4">
          <label className="block text-[13px] text-muted">
            {t('auth.login.emailLabel')}
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block h-10 w-full rounded-control border border-line px-3 text-sm text-ink outline-none focus:border-ink"
            />
          </label>

          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={isNewCompany}
              onChange={(e) => setIsNewCompany(e.target.checked)}
            />
            {t('auth.login.newCompanyCheckbox')}
          </label>

          {isNewCompany && (
            <div className="space-y-3 border-l-2 border-line pl-3">
              <label className="block text-[13px] text-muted">
                {t('auth.login.companyNameLabel')}
                <input
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="mt-1 block h-10 w-full rounded-control border border-line px-3 text-sm text-ink outline-none focus:border-ink"
                />
              </label>
              <div className="flex gap-3">
                <label className="text-[13px] text-muted">
                  {t('auth.login.fyeMonthLabel')}
                  <input
                    type="number" min={1} max={12} value={fyeMonth}
                    onChange={(e) => setFyeMonth(Number(e.target.value))}
                    className="mt-1 block h-10 w-20 rounded-control border border-line px-3 text-sm text-ink outline-none focus:border-ink"
                  />
                </label>
                <label className="text-[13px] text-muted">
                  {t('auth.login.fyeDayLabel')}
                  <input
                    type="number" min={1} max={31} value={fyeDay}
                    onChange={(e) => setFyeDay(Number(e.target.value))}
                    className="mt-1 block h-10 w-20 rounded-control border border-line px-3 text-sm text-ink outline-none focus:border-ink"
                  />
                </label>
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-card border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800" role="alert">
              {error}
            </p>
          )}

          <Button type="submit" disabled={busy} className="w-full justify-center">
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            {isNewCompany ? t('auth.login.createCompanyButton') : t('auth.login.continueButton')}
          </Button>
        </form>
      </Card>
    </Container>
  )
}
