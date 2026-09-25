/** The owner's purge requests, on a page of their own: /company-settings/purge-requests (round 3, item 9c, DECISIONS #121). */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import { parsePath, ROUTES } from '../router/routes'

const auth = vi.hoisted(() => ({ value: { status: 'signed-in', role: 'owner' } as Record<string, unknown> }))
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => auth.value }))
vi.mock('../router/navigate', () => ({ navigate: vi.fn() }))
vi.mock('../features/ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../features/ops/opsApi')>()),
  opsApi: { listPurgeRequests: vi.fn(), cancelPurgeRequest: vi.fn() },
}))

import { opsApi } from '../features/ops/opsApi'
import { navigate } from '../router/navigate'
import { PurgeRequestsPage } from './PurgeRequestsPage'

beforeEach(async () => {
  vi.resetAllMocks()
  auth.value = { status: 'signed-in', role: 'owner' }
  vi.mocked(opsApi.listPurgeRequests).mockResolvedValue([{ id: 4, filename: 'old.pdf', requested_at: '2026-09-25 01:00:00', requested_by: 'o@x.y' }])
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('the Purge requests page', () => {
  it('is a route of its own under Company Settings, translated, and not the settings page', () => {
    expect(ROUTES['purge-requests'].path).toBe('/company-settings/purge-requests')
    expect(parsePath('/company-settings/purge-requests')).toBe('purge-requests')
    expect(parsePath('/company-settings')).toBe('company-settings')
  })

  it('shows the owner their pending requests and a way back to Company Settings', async () => {
    render(<PurgeRequestsPage />)
    expect(await screen.findByText('old.pdf')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Purge requests (1)' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to Company Settings' }).getAttribute('href')).toBe('/company-settings')
    expect(screen.getByRole('button', { name: 'Cancel purge' })).toBeTruthy()
  })

  it('sits in the same one centred column as Company Settings', async () => {
    render(<PurgeRequestsPage />)
    await screen.findByText('old.pdf')
    const column = screen.getByTestId('purge-requests-column')
    expect(column.className).toContain('mx-auto')
    expect(column.className).toContain('max-w-2xl')
  })

  it.each(['admin', 'user', 'viewer'])('sends a %s back to Company Settings and never asks for the list (the endpoint is owner-only)', async (role) => {
    auth.value = { status: 'signed-in', role }
    render(<PurgeRequestsPage />)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/company-settings'))
    expect(opsApi.listPurgeRequests).not.toHaveBeenCalled()
    expect(screen.queryByText('old.pdf')).toBeNull()
  })

  it('sends a signed-out visitor home, like every page behind a session', async () => {
    auth.value = { status: 'signed-out', role: null }
    render(<PurgeRequestsPage />)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
    expect(opsApi.listPurgeRequests).not.toHaveBeenCalled()
  })
})
