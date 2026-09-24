/** The Company Settings form's values and the pure rules around them
 * (2026-09-24, round 12, DECISIONS #79) — kept apart from the page so how a
 * pre-fill lands on the form is testable without rendering. */

import type { Company, CompanyProfilePrefill, CompanyUpdate } from '../auth/authApi'

export interface CompanyForm {
  name: string
  fyeMonth: number
  fyeDay: number
  uen: string
  gstRegistered: boolean
  registeredAddress: string
}

export type CompanyFormField = keyof CompanyForm

/** The saved company as form values. uen/gst_registered/registered_address are
 * optional on Company (a backend older than them sends none), so they read as
 * blank / not registered rather than undefined. */
export function formFromCompany(company: Company): CompanyForm {
  return {
    name: company.name,
    fyeMonth: company.fye_month,
    fyeDay: company.fye_day,
    uen: company.uen ?? '',
    gstRegistered: company.gst_registered ?? false,
    registeredAddress: company.registered_address ?? '',
  }
}

/** Lays an extracted business profile over the form. A value the document did
 * not state (null) leaves that field exactly as it was — a pre-fill fills, it
 * never blanks. `changed` lists only the fields whose value actually differs
 * afterwards, so the form can show the owner what the document is changing. */
export function applyPrefill(
  form: CompanyForm,
  prefill: CompanyProfilePrefill,
): { form: CompanyForm; changed: CompanyFormField[] } {
  const next: CompanyForm = {
    name: prefill.name ?? form.name,
    fyeMonth: prefill.fye_month ?? form.fyeMonth,
    fyeDay: prefill.fye_day ?? form.fyeDay,
    uen: prefill.uen ?? form.uen,
    gstRegistered: prefill.gst_registered ?? form.gstRegistered,
    registeredAddress: prefill.registered_address ?? form.registeredAddress,
  }
  const changed = (Object.keys(next) as CompanyFormField[]).filter((field) => next[field] !== form[field])
  return { form: next, changed }
}

/** Whether the backend behind this session knows the identity fields (UEN,
 * GST registered, registered address). A backend from before round 12 omits
 * `uen` from the company it returns; the new one always sends the key (null
 * when unset). The frontend deploys on every push and the backend only when
 * redeployed, so against an old backend the form must not offer fields that
 * "save" into nothing — it falls back to the name/year-end form it always
 * was (docs/DECISIONS.md, the frontend-before-backend rule). */
export function backendHasIdentityFields(company: Company | null): boolean {
  return company?.uen !== undefined
}

/** The PATCH /api/companies/{id} body for the form. The identity fields are
 * sent only when the backend has them: an older one would silently ignore
 * them and the page would report "Saved." for values it never stored. */
export function toUpdate(form: CompanyForm, includeIdentityFields: boolean): CompanyUpdate {
  const base: CompanyUpdate = { name: form.name, fye_month: form.fyeMonth, fye_day: form.fyeDay }
  if (!includeIdentityFields) return base
  return { ...base, uen: form.uen, gst_registered: form.gstRegistered, registered_address: form.registeredAddress }
}
