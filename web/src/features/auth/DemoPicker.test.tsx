/** The demo-account picker (round 20, item 1; four logins since S1d, DECISIONS #137): each one the ordinary
 * login with its own email, a named person, their role and a line on what that role can do. There is no `user` role in the demo. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

const login = vi.fn()
vi.mock('./AuthContext', () => ({ useAuth: () => ({ login }) }))
vi.mock('../../router/navigate', () => ({ navigate: vi.fn() }))

import { DEMO_ACCOUNTS } from '../../config/demo'
import { navigate } from '../../router/navigate'
import { DemoPicker } from './DemoPicker'

beforeEach(async () => {
  await i18n.changeLanguage('en')
  login.mockReset()
  vi.mocked(navigate).mockReset()
})
afterEach(cleanup)

// One button per account, found by the list (the sheet's own close button carries a translated label).
const rows = () => within(screen.getByRole('dialog')).getAllByRole('listitem').map((li) => within(li).getByRole('button'))

describe('the demo roster', () => {
  it('has exactly four logins, in this order, each a distinct address: owner, admin, admin and a view-only Corp Sec', () => {
    expect(DEMO_ACCOUNTS.map((a) => a.email)).toEqual([
      'owner_priya@try-demo.test', 'admin_jonathan@try-demo.test', 'admin_aisyah@try-demo.test', 'corpsec_rachel@try-demo.test',
    ])
    expect(new Set(DEMO_ACCOUNTS.map((a) => a.email)).size).toBe(4)
    expect(DEMO_ACCOUNTS.map((a) => a.role)).toEqual(['owner', 'admin', 'admin', 'viewer'])
  })

  it('offers no `user` role at all', () => {
    expect(DEMO_ACCOUNTS.some((a) => (a.role as string) === 'user')).toBe(false)
  })
})

describe('DemoPicker', () => {
  it('lists four named people, each with their role shown and a description of what that role can do', () => {
    render(<DemoPicker open onClose={vi.fn()} />)
    expect(rows()).toHaveLength(4)
    const [owner, jonathan, aisyah, rachel] = rows().map((r) => r.textContent ?? '')
    expect(owner).toContain('Priya Ramanathan')
    expect(owner).toContain('Owner')
    expect(owner).toContain('Full access, including editing Company Settings')
    expect(owner).toContain('owner_priya@try-demo.test')
    expect(jonathan).toContain('Jonathan Ong')
    expect(jonathan).toContain('Admin')
    expect(jonathan).toContain('HR and Finance Manager')
    expect(aisyah).toContain('Nur Aisyah Rahman')
    expect(aisyah).toContain('Admin')
    expect(aisyah).toContain('same access as Jonathan')
    expect(rachel).toContain('Rachel Tan Hui Min')
    expect(rachel).toContain('Corp Sec, view only')
    expect(rachel).toContain('cannot upload, edit')
    expect(rachel).toContain('corpsec_rachel@try-demo.test')
  })

  it('shows a role on every row, and no row says User', () => {
    render(<DemoPicker open onClose={vi.fn()} />)
    const text = rows().map((r) => r.textContent ?? '')
    for (const row of text) expect(row).toMatch(/Owner|Admin|Viewer/)
    expect(text.join(' ')).not.toMatch(/\bUser\b/)
  })

  it('reads as self-explanatory in every language: a name, a role and a description, never an empty string or a raw key', async () => {
    for (const lang of ['ms', 'zh', 'ta']) {
      await i18n.changeLanguage(lang)
      const { unmount } = render(<DemoPicker open onClose={vi.fn()} />)
      for (const row of rows()) {
        expect(row.textContent ?? '', lang).not.toMatch(/home\.demo|undefined|\{\{/)
        expect((row.textContent ?? '').length, lang).toBeGreaterThan(60)
      }
      unmount()
    }
  })

  it.each(DEMO_ACCOUNTS.map((a) => [a.id, a.email] as const))('choosing %s logs in with exactly %s and lands where the login form does', async (id, email) => {
    login.mockResolvedValue(undefined)
    render(<DemoPicker open onClose={vi.fn()} />)

    fireEvent.click(rows()[DEMO_ACCOUNTS.findIndex((a) => a.id === id)]!)

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
    expect(login).toHaveBeenCalledTimes(1)
    expect(login).toHaveBeenCalledWith({ email })
  })

  it('while one account is signing in every row is disabled and the working row shows progress', async () => {
    let finish: () => void = () => undefined
    login.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
    render(<DemoPicker open onClose={vi.fn()} />)

    fireEvent.click(rows()[1]!)

    await waitFor(() => expect(rows().every((row) => (row as HTMLButtonElement).disabled)).toBe(true))
    expect(within(rows()[1]!).getByLabelText('Opening the demo…')).toBeTruthy()
    expect(login).toHaveBeenCalledTimes(1)
    finish()
  })

  it('a refused login says so in the sheet, navigates nowhere and leaves every row usable', async () => {
    login.mockRejectedValue(new Error('No company membership yet'))
    render(<DemoPicker open onClose={vi.fn()} />)

    fireEvent.click(rows()[2]!)

    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't open the demo")
    expect(navigate).not.toHaveBeenCalled()
    expect(rows().every((row) => !(row as HTMLButtonElement).disabled)).toBe(true)
  })

  it('a second attempt after a failure clears the message and goes through', async () => {
    login.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce(undefined)
    render(<DemoPicker open onClose={vi.fn()} />)
    fireEvent.click(rows()[3]!)
    await screen.findByRole('alert')

    fireEvent.click(rows()[3]!)

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('closes on Escape without signing anyone in, and renders nothing when closed', async () => {
    const onClose = vi.fn()
    const { rerender } = render(<DemoPicker open onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(login).not.toHaveBeenCalled()

    rerender(<DemoPicker open={false} onClose={onClose} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('reads in the chosen language, with the role names the rest of the app uses', async () => {
    await i18n.changeLanguage('ms')
    render(<DemoPicker open onClose={vi.fn()} />)
    expect(rows()[0]!.textContent).toContain('Pemilik')
    expect(rows()[3]!.textContent).toContain('Pelihat')
  })
})
