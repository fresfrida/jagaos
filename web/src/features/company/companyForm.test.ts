import { describe, expect, it } from 'vitest'
import type { Company, CompanyProfilePrefill } from '../auth/authApi'
import { applyPrefill, backendHasIdentityFields, formFromCompany, prefillChanges, toUpdate } from './companyForm'

const company: Company = {
  id: 1, name: 'Old Name Pte Ltd', fye_month: 12, fye_day: 31, timezone: 'Asia/Singapore',
  uen: null, gst_registered: false, registered_address: null,
}

const blankPrefill: CompanyProfilePrefill = {
  document_id: 9, filename: 'bizfile.pdf', name: null, uen: null, fye_month: null, fye_day: null,
  gst_registered: null, registered_address: null,
}

describe('formFromCompany', () => {
  it('reads the saved company', () => {
    expect(formFromCompany(company)).toEqual({
      name: 'Old Name Pte Ltd', fyeMonth: 12, fyeDay: 31, uen: '', gstRegistered: false, registeredAddress: '',
    })
  })

  it('copes with a backend that predates the identity fields', () => {
    const { uen, gst_registered, registered_address, ...legacy } = company
    void uen; void gst_registered; void registered_address
    expect(formFromCompany(legacy)).toMatchObject({ uen: '', gstRegistered: false, registeredAddress: '' })
  })
})

describe('applyPrefill', () => {
  it('fills every value the document stated and reports exactly those as changed', () => {
    const { form, changed } = applyPrefill(formFromCompany(company), {
      ...blankPrefill, name: 'Harbourlight Trading Pte. Ltd.', uen: '202412345K', fye_month: 6, fye_day: 30,
      gst_registered: true, registered_address: '18 Robinson Road',
    })
    expect(form).toEqual({
      name: 'Harbourlight Trading Pte. Ltd.', fyeMonth: 6, fyeDay: 30, uen: '202412345K',
      gstRegistered: true, registeredAddress: '18 Robinson Road',
    })
    expect(changed.sort()).toEqual(['fyeDay', 'fyeMonth', 'gstRegistered', 'name', 'registeredAddress', 'uen'])
  })

  it('leaves a field the document did not state exactly as it was', () => {
    const { form, changed } = applyPrefill(formFromCompany(company), { ...blankPrefill, name: 'Only A Name Pte Ltd' })
    expect(form.fyeMonth).toBe(12)
    expect(form.fyeDay).toBe(31)
    expect(form.gstRegistered).toBe(false)
    expect(changed).toEqual(['name'])
  })

  it('does not flag a value that equals what the company already has', () => {
    const { changed } = applyPrefill(formFromCompany(company), { ...blankPrefill, name: 'Old Name Pte Ltd', fye_month: 12 })
    expect(changed).toEqual([])
  })

  it('an explicit "not GST registered" is a stated value, not a missing one', () => {
    const registered = { ...formFromCompany(company), gstRegistered: true }
    const { form, changed } = applyPrefill(registered, { ...blankPrefill, gst_registered: false })
    expect(form.gstRegistered).toBe(false)
    expect(changed).toEqual(['gstRegistered'])
  })
})

describe('toUpdate', () => {
  it('maps the whole form onto the PATCH body', () => {
    expect(toUpdate(formFromCompany(company), true)).toEqual({
      name: 'Old Name Pte Ltd', fye_month: 12, fye_day: 31, uen: '', gst_registered: false, registered_address: '',
    })
  })

  it('leaves the identity fields out against a backend that predates them, rather than "saving" into nothing', () => {
    expect(toUpdate(formFromCompany(company), false)).toEqual({ name: 'Old Name Pte Ltd', fye_month: 12, fye_day: 31 })
  })
})

describe('backendHasIdentityFields', () => {
  it('is true once the backend sends uen at all, even as null', () => {
    expect(backendHasIdentityFields(company)).toBe(true)
    expect(backendHasIdentityFields({ ...company, uen: '202412345K' })).toBe(true)
  })

  it('is false when the backend omits it (an older deploy) or there is no company yet', () => {
    const { uen, ...legacy } = company
    void uen
    expect(backendHasIdentityFields(legacy)).toBe(false)
    expect(backendHasIdentityFields(null)).toBe(false)
  })
})

describe('prefillChanges', () => {
  const current = formFromCompany({ ...company, uen: '202000001A', gst_registered: false, registered_address: '1 Old Road' })

  it('lists each field the profile would change with the old and the new value, in form order', () => {
    const changes = prefillChanges(current, {
      ...blankPrefill, name: 'New Name Pte Ltd', uen: '202412345K', fye_month: 6, fye_day: 30,
      gst_registered: true, registered_address: '18 Robinson Road',
    })
    expect(changes.map((c) => c.field)).toEqual(['name', 'fyeMonth', 'fyeDay', 'uen', 'gstRegistered', 'registeredAddress'])
    expect(changes.find((c) => c.field === 'uen')).toEqual({ field: 'uen', before: '202000001A', after: '202412345K' })
    expect(changes.find((c) => c.field === 'gstRegistered')).toEqual({ field: 'gstRegistered', before: false, after: true })
  })

  it('omits a field the profile did not state and one that already matches', () => {
    const changes = prefillChanges(current, { ...blankPrefill, name: 'Old Name Pte Ltd', uen: '202412345K' })
    expect(changes).toEqual([{ field: 'uen', before: '202000001A', after: '202412345K' }])
  })

  it('is empty when nothing would change, so the sheet can say so instead of offering an apply', () => {
    expect(prefillChanges(current, blankPrefill)).toEqual([])
    expect(prefillChanges(current, { ...blankPrefill, uen: '202000001A', fye_month: 12 })).toEqual([])
  })

  it('agrees with applyPrefill on what changes', () => {
    const prefill = { ...blankPrefill, name: 'X Pte Ltd', gst_registered: true }
    const applied = applyPrefill(current, prefill)
    expect(prefillChanges(current, prefill).map((c) => c.field).sort()).toEqual([...applied.changed].sort())
    for (const change of prefillChanges(current, prefill)) expect(applied.form[change.field]).toBe(change.after)
  })
})
