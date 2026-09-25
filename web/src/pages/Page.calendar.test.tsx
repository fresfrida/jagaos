/** /calendar needs a session (DECISIONS #106): the sample-data preview it used to show everyone else is gone. */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const auth = vi.hoisted(() => ({ value: { status: 'signed-out', role: null } as { status: string; role: string | null } }))
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => auth.value }))
vi.mock('../router/navigate', () => ({ navigate: vi.fn() }))
vi.mock('../features/calendar/CalendarHub', () => ({ CalendarHub: () => <div data-testid="calendar-hub" /> }))

import { navigate } from '../router/navigate'
import { Page } from './Page'

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(navigate).mockReset()
  auth.value = { status: 'signed-out', role: null }
})
afterEach(cleanup)

describe('the calendar route', () => {
  it('signed out: no calendar, no sample data, and the visitor is sent home', async () => {
    render(<Page route="calendar" />)
    expect(screen.queryByTestId('calendar-hub')).toBeNull()
    expect(document.body.textContent).not.toMatch(/sample data/i)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
  })

  it('while the session is still being checked: a placeholder, no calendar and no redirect yet', () => {
    auth.value = { status: 'loading', role: null }
    render(<Page route="calendar" />)
    expect(screen.queryByTestId('calendar-hub')).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  it.each(['owner', 'admin', 'user', 'viewer'])('a signed-in %s gets the real Calendar under its title', (role) => {
    auth.value = { status: 'signed-in', role }
    render(<Page route="calendar" />)
    expect(screen.getByTestId('calendar-hub')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Calendar')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('/tags and /get-started are not pages any more', () => {
    for (const route of ['tags', 'get-started']) {
      // @ts-expect-error: these ids were removed from ResolvedRoute; a stale value must not render a page
      const { container } = render(<Page route={route} />)
      expect(container.textContent).toBe('')
      cleanup()
    }
  })
})
