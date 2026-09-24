/** Pure shaping for the company switcher (2026-09-24, round 12, DECISIONS
 * #77) — kept apart from the component so the grouping rule is testable
 * without rendering. */

import type { MyCompany } from './authApi'

export interface CompanySection {
  /** The group's name, or null for companies that sit under no group. */
  label: string | null
  companies: MyCompany[]
}

/** Companies grouped by the group they sit under, sections in order of first
 * appearance and companies in the order given (the server sends membership
 * order). Group names only ever arrive on an owner membership, so a
 * non-owner's rows all land in the one unlabelled section. */
export function groupCompanies(companies: MyCompany[]): CompanySection[] {
  const sections: CompanySection[] = []
  for (const company of companies) {
    const label = company.group_name
    const existing = sections.find((section) => section.label === label)
    if (existing) existing.companies.push(company)
    else sections.push({ label, companies: [company] })
  }
  return sections
}

/** A switcher is only worth showing for someone who can switch: two or more
 * memberships. Everyone else (nearly every user, and every viewer) sees no
 * switcher and no trace of a group at all. */
export function hasSwitchableCompanies(companies: MyCompany[]): boolean {
  return companies.length >= 2
}

/** Roles are worth spelling out in the list only when they differ between
 * companies (an owner of one, a viewer of another) — otherwise it is noise
 * repeated on every row. */
export function rolesDiffer(companies: MyCompany[]): boolean {
  return new Set(companies.map((company) => company.role)).size > 1
}
