/** Company Settings' sections by role (round 21, A2 and A5, DECISIONS #101): the compliance checklist for admin and owner, and
 * a link to the purge requests for the owner alone (they are a page of their own since round 3, item 9c, DECISIONS #121, not a section
 * of this one). Anyone lower is sent back to the Calendar, as before. */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const auth = vi.hoisted(() => ({
  value: { status: 'signed-in', role: 'owner', company: { id: 1, name: 'Try Demo Pte Ltd', fye_month: 12, fye_day: 31, uen: '', gst_registered: false, registered_address: '', timezone: 'Asia/Singapore' }, refreshCompany: vi.fn() } as Record<string, unknown>,
}))
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => auth.value }))
vi.mock('../router/navigate', () => ({ navigate: vi.fn() }))
vi.mock('../features/company/useBusinessProfile', () => ({ useBusinessProfile: () => ({ state: { status: 'none' } }) }))
vi.mock('../features/company/BusinessProfileSection', () => ({ BusinessProfileSection: () => null }))
vi.mock('../features/company/useCompanyProfilePrefill', () => ({ useCompanyProfilePrefill: () => ({ status: 'idle' }) }))
vi.mock('../features/ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../features/ops/opsApi')>()),
  opsApi: { listExpectations: vi.fn(), listDocuments: vi.fn(), listPurgeRequests: vi.fn() },
}))

import { opsApi } from '../features/ops/opsApi'
import { navigate } from '../router/navigate'
import { CompanySettingsPage } from './CompanySettingsPage'

beforeEach(async () => {
  vi.resetAllMocks()
  auth.value = { ...auth.value, status: 'signed-in', role: 'owner' }
  vi.mocked(opsApi.listExpectations).mockResolvedValue([{ id: 1, doc_type: 'constitution', label: 'Company constitution', status: 'missing', evidence_document_id: null } as never])
  vi.mocked(opsApi.listDocuments).mockResolvedValue([])
  vi.mocked(opsApi.listPurgeRequests).mockResolvedValue([{ id: 4, filename: 'old.pdf', requested_at: '2026-09-25 01:00:00', requested_by: 'o@x.y' }])
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('CompanySettingsPage sections', () => {
  it('the owner gets the form, the compliance checklist and a link to the purge requests, which are NOT listed here any more', async () => {
    render(<CompanySettingsPage />)
    expect(await screen.findByText('Company constitution')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Compliance checklist' })).toBeTruthy()
    expect(screen.getAllByRole('heading', { name: /^Compliance checklist/ })).toHaveLength(1) // one heading, not the same words twice
    const link = screen.getByRole('link', { name: /Purge requests/ })
    expect(link.getAttribute('href')).toBe('/company-settings/purge-requests')
    expect(screen.queryByText('old.pdf')).toBeNull() // the list itself lives on its own page now
    expect(screen.queryByRole('heading', { name: /^Purge requests/ })).toBeNull()
    expect(opsApi.listPurgeRequests).not.toHaveBeenCalled() // and this page no longer fetches it
  })

  it('the form, the checklist and the link share ONE centred column, and none sets a width of its own (DECISIONS #111)', async () => {
    const { container } = render(<CompanySettingsPage />)
    await screen.findByText('Company constitution')
    const column = screen.getByTestId('settings-column')
    expect(column.className).toContain('mx-auto')
    expect(column.className).toContain('max-w-2xl')
    expect(column.querySelector('.rounded-card')).toBeTruthy()
    expect(within(column).getByRole('region', { name: 'Compliance checklist' })).toBeTruthy()
    expect(within(column).getByRole('link', { name: /Purge requests/ })).toBeTruthy()
    // ...and there is no other max-width anywhere under the column: it used to be 448px on the card and 672px on the two sections.
    expect([...column.querySelectorAll('*')].filter((el) => /(^|\s)max-w-(md|2xl)(\s|$)/.test(el.getAttribute('class') ?? ''))).toEqual([])
    expect(container.querySelectorAll('[data-testid="settings-column"]')).toHaveLength(1)
  })

  it('an admin gets the checklist (read-only settings above it) and no link to the purge requests, and never asks for them', async () => {
    auth.value = { ...auth.value, role: 'admin' }
    render(<CompanySettingsPage />)
    expect(await screen.findByText('Company constitution')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Purge requests/ })).toBeNull()
    expect(opsApi.listPurgeRequests).not.toHaveBeenCalled() // the endpoint is owner-only: do not ask and get a 403
  })

  it.each(['user', 'viewer'])('a %s is sent back to the Calendar and fetches nothing', async (role) => {
    auth.value = { ...auth.value, role }
    render(<CompanySettingsPage />)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/calendar'))
    expect(opsApi.listExpectations).not.toHaveBeenCalled()
    expect(opsApi.listPurgeRequests).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Compliance checklist' })).toBeNull()
  })
})
