/** One demo picker for every "Get Started" / "Pick a demo role" button (DECISIONS #106). */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

const login = vi.fn()
vi.mock('./AuthContext', () => ({ useAuth: () => ({ login }) }))
vi.mock('../../router/navigate', () => ({ navigate: vi.fn() }))

import { openDemoPicker, onOpenDemoPicker } from '../../lib/demoPickerTrigger'
import { navigate } from '../../router/navigate'
import { DemoPickerHost } from './DemoPickerHost'

beforeEach(async () => {
  await i18n.changeLanguage('en')
  login.mockReset()
  vi.mocked(navigate).mockReset()
})
afterEach(cleanup)

describe('the demo picker signal', () => {
  it('reaches every listener until it unsubscribes', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = onOpenDemoPicker(a)
    const offB = onOpenDemoPicker(b)
    openDemoPicker()
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1])
    offA()
    openDemoPicker()
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 2])
    offB()
  })
})

describe('DemoPickerHost', () => {
  it('is closed until something signals it, then opens the six-account dialog', () => {
    render(<DemoPickerHost />)
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => openDemoPicker())
    const dialog = screen.getByRole('dialog', { name: 'Try the demo as' })
    expect(dialog).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^(Owner|Admin|User|Viewer)/ }).length).toBeGreaterThanOrEqual(4)
    expect(login).not.toHaveBeenCalled() // opening signs nobody in
  })

  it('choosing a role is the ordinary login, then home', async () => {
    login.mockResolvedValue(undefined)
    render(<DemoPickerHost />)
    act(() => openDemoPicker())
    fireEvent.click(screen.getByRole('button', { name: /^Viewer/ }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/'))
    expect(login).toHaveBeenCalledWith({ email: 'viewer@try-demo.test' })
  })

  it('stops listening when it unmounts, which is when someone signs in', () => {
    const { unmount } = render(<DemoPickerHost />)
    unmount()
    act(() => openDemoPicker())
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
