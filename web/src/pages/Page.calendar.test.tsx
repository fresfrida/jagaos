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

describe('the calendar page\'s title and subtitle (DECISIONS #108, the subtitle\'s final text from the senior UI/UX batch)', () => {
  const signedIn = () => { auth.value = { status: 'signed-in', role: 'owner' } }

  it('says what the calendar is and who sees it', () => {
    signedIn()
    render(<Page route="calendar" />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Calendar')
    expect(screen.getByText('Your documents, by date.')).toBeTruthy()
    expect(screen.queryByText(/events and deadlines/i)).toBeNull() // the old subtitle
    expect(screen.queryByText(/everyone in the team/i)).toBeNull() // and the text this replaced within the same day (DECISIONS #108)
  })

  it.each([
    ['zh', '日历', '您的文件，按日期排列。'],
    ['ms', 'Kalendar', 'Dokumen anda, mengikut tarikh.'],
    ['ta', 'நாட்காட்டி', 'உங்கள் ஆவணங்கள், தேதி வாரியாக.'],
  ])('is translated in %s, title and subtitle', async (language, title, subtitle) => {
    signedIn()
    await i18n.changeLanguage(language)
    render(<Page route="calendar" />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(title)
    expect(screen.getByText(subtitle)).toBeTruthy()
  })
})

