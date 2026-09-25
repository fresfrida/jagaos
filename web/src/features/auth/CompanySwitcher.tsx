/** Switch which of your companies the app is showing (2026-09-24, round 12,
 * DECISIONS #77). Renders NOTHING unless the user belongs to two or more —
 * so a user or viewer scoped to one company sees no switcher and no group.
 *
 * A native <select> grouped with <optgroup> by the group the companies sit
 * under: the same plain-control choice as the language switcher, and it gets
 * the platform's own picker on a phone. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { roleLabel } from '../ops/opsShared'
import { cn } from '../../lib/cn'
import { useAuth } from './AuthContext'
import { groupCompanies, hasSwitchableCompanies, rolesDiffer } from './companySwitcherModel'
import { useMyCompanies } from './MyCompaniesContext'

export function CompanySwitcher({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { company, switchCompany } = useAuth()
  const companies = useMyCompanies()
  const [error, setError] = useState<string | null>(null)

  if (!hasSwitchableCompanies(companies) || !company) return null

  const showRoles = rolesDiffer(companies)
  const label = (name: string, role: string) => (showRoles ? `${name} · ${roleLabel(t, role)}` : name)

  return (
    <div className={className}>
      <select
        value={company.id}
        aria-label={t('header.switchCompany')}
        aria-invalid={error !== null}
        title={error ?? undefined}
        onChange={(event) => {
          setError(null)
          switchCompany(Number(event.target.value)).catch((e: unknown) =>
            setError(e instanceof Error ? e.message : String(e)),
          )
        }}
        className={cn(
          'w-full rounded-md border bg-white px-2 py-1.5 text-[14px] text-ink outline-none focus:border-ink',
          error ? 'border-red-400' : 'border-line',
        )}
      >
        {groupCompanies(companies).map((section) => {
          const options = section.companies.map((c) => (
            <option key={c.id} value={c.id}>{label(c.name, c.role)}</option>
          ))
          return section.label === null ? options : (
            <optgroup key={section.label} label={section.label}>{options}</optgroup>
          )
        })}
      </select>
      {error && <p role="alert" className="mt-1 text-[13px] text-red-700">{error}</p>}
    </div>
  )
}
