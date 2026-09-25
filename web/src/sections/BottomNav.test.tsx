/** The phone bottom bar (round 21, A4, DECISIONS #101): every label on one line, and the cells the same width. jsdom has no
 * layout, so what is pinned here is what makes that true (no wrapping, equal-basis cells, the short wording where the full name
 * does not fit a 72px cell); the widths themselves were measured in a browser, in four languages, at 375, 360 and 320px. */

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const auth = vi.hoisted(() => ({ value: { role: 'owner' } as { role: string | null } }))
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => auth.value }))
vi.mock('../lib/uploadTrigger', () => ({ openUploadSheet: vi.fn() }))

import { BottomNav } from './BottomNav'

beforeEach(async () => {
  auth.value = { role: 'owner' }
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

const nav = () => screen.getByRole('navigation')

describe('BottomNav', () => {
  it('shows five labels, the two that were too wide in their short form, and the rest unchanged', () => {
    render(<BottomNav current="calendar" />)
    const labels = within(nav()).getAllByText(/^(Calendar|Tags|Upload|Search|Files|Company Files)$/).map((n) => n.textContent)
    expect(labels).toEqual(['Calendar', 'Tags', 'Upload', 'Search', 'Files'])
    expect(within(nav()).queryByText('Company Files')).toBeNull()
  })

  it('keeps the full name as the accessible name where the short label is part of it', () => {
    render(<BottomNav current="calendar" />)
    expect(within(nav()).getByRole('link', { name: 'Company Files' }).textContent).toBe('Files')
    expect(within(nav()).getByRole('link', { name: 'Calendar' })).toBeTruthy() // no override needed: the label IS the name
  })

  it('no label may wrap, and no cell may be sized by its label: they are all equal', () => {
    render(<BottomNav current="calendar" />)
    for (const label of ['Calendar', 'Tags', 'Upload', 'Search', 'Files']) {
      expect(within(nav()).getByText(label).className, label).toContain('whitespace-nowrap')
    }
    const cells = [...nav().querySelectorAll('a'), within(nav()).getByText('Upload').parentElement!]
    for (const cell of cells) {
      expect(cell.className).toContain('flex-1')
      expect(cell.className).toContain('basis-0')
      expect(cell.className).toContain('min-w-0')
    }
  })

  it('keeps type at 12px, the accessibility floor of round 20', () => {
    render(<BottomNav current="calendar" />)
    expect(within(nav()).getByRole('link', { name: 'Calendar' }).className).toContain('text-[12px]')
    expect(within(nav()).getByText('Upload').className).toContain('text-[12px]')
  })

  it.each([
    ['zh', ['日历', '标签', '上传', '搜索', '公司文件']],
    ['ms', ['Kalendar', 'Tag', 'Muat Naik', 'Carian', 'Fail']],
    ['ta', ['நாட்காட்டி', 'குறிச்சொல்', 'பதிவேற்று', 'தேடல்', 'கோப்புகள்']],
  ])('uses these five labels in %s', async (language, expected) => {
    await i18n.changeLanguage(language)
    render(<BottomNav current="calendar" />)
    const labels = [...nav().querySelectorAll('span.whitespace-nowrap')].map((n) => n.textContent)
    expect(labels).toEqual(expected)
  })

  it('a viewer gets four equal cells and no Upload button', () => {
    auth.value = { role: 'viewer' }
    render(<BottomNav current="calendar" />)
    expect(nav().querySelectorAll('a')).toHaveLength(4)
    expect(within(nav()).queryByRole('button')).toBeNull()
    for (const cell of nav().querySelectorAll('a')) expect(cell.className).toContain('basis-0')
  })

  it('marks the current page', () => {
    render(<BottomNav current="company-files" />)
    expect(within(nav()).getByRole('link', { name: 'Company Files' }).getAttribute('aria-current')).toBe('page')
    expect(within(nav()).getByRole('link', { name: 'Calendar' }).getAttribute('aria-current')).toBeNull()
  })
})
