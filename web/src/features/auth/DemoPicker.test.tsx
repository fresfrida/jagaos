/** The demo-account picker (round 20, item 1): six seeded accounts, each one the ordinary
 * login with its own email, with a line on what the role can do. */

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
  it('has the six seeded accounts of Try Demo Pte Ltd, each a distinct real address, with owner first', () => {
    expect(DEMO_ACCOUNTS.map((a) => a.email)).toEqual([
      'owner@try-demo.test', 'admin@try-demo.test', 'user@try-demo.test', 'user1@try-demo.test', 'user2@try-demo.test', 'viewer@try-demo.test',
    ])
    expect(new Set(DEMO_ACCOUNTS.map((a) => a.email)).size).toBe(6)
    expect(DEMO_ACCOUNTS.map((a) => a.role)).toEqual(['owner', 'admin', 'user', 'user', 'user', 'viewer'])
  })
})

describe('DemoPicker', () => {
  it('lists every account with its role and a description of what that role can do', () => {
    render(<DemoPicker open onClose={vi.fn()} />)
    expect(rows()).toHaveLength(6)
    const owner = rows()[0]!
    expect(owner.textContent).toContain('Owner')
    expect(owner.textContent).toContain('Full access, including editing Company Settings')
    expect(owner.textContent).toContain('owner@try-demo.test')
    expect(rows()[5]!.textContent).toContain('Read-only')
    expect(rows()[5]!.textContent).toContain('viewer@try-demo.test')
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
    expect(rows()[5]!.textContent).toContain('Pelihat')
  })
})
