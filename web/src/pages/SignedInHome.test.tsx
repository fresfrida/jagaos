/** The signed-in home hub (round 20, item 2, final ruling): a dominant Upload card and a quiet Only me
 * row, in black, white and tints of black; nothing embedded; private files never surface here. */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const auth = vi.hoisted(() => ({ value: { status: 'signed-in', role: 'owner' } as { status: string; role: string | null } }))
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => auth.value }))
vi.mock('../features/ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../features/ops/opsApi')>()),
  opsApi: { listReviewItems: vi.fn() },
}))

import { opsApi, type ReviewItem } from '../features/ops/opsApi'
import { SignedInHome } from './SignedInHome'

const list = vi.mocked(opsApi.listReviewItems)
const item = (id: number, over: Partial<ReviewItem> = {}): ReviewItem => ({
  id, document_id: id, document_filename: `secret-${id}.pdf`, document_media_type: 'application/pdf', document_description: 'A very private thing',
  document_bucket: null, document_lane: 'invoice', document_doc_type: 'invoice', document_vendor_name: null,
  thread_id: `t${id}`, reason: 'clean', question: '[]', proposed_json: '{}', status: 'open', ...over,
})

beforeEach(async () => {
  vi.resetAllMocks()
  auth.value = { status: 'signed-in', role: 'owner' }
  list.mockResolvedValue([])
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('SignedInHome', () => {
  it('has two entries: Upload, as the big card, and Only me, as a quiet row; nothing is embedded', () => {
    const { container } = render(<SignedInHome />)

    expect(screen.getByTestId('home-upload').getAttribute('href')).toBe('/upload')
    expect(screen.getByTestId('home-only-me').getAttribute('href')).toBe('/only-me')
    expect(within(screen.getByTestId('home-upload')).getByText('Upload')).toBeTruthy()
    expect(within(screen.getByTestId('home-only-me')).getByText('Only me')).toBeTruthy()
    expect(screen.queryByTestId('document-input')).toBeNull() // no upload rows here
    expect(container.querySelectorAll('a')).toHaveLength(2) // and nothing else to click
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('sr-only') // a heading for a screen reader, none on screen
  })

  it('is black, white and tints of black only: no green anywhere on the page', () => {
    list.mockResolvedValue([item(1, { can_resolve: true })])
    const { container } = render(<SignedInHome />)

    expect(screen.getByTestId('home-upload').className).toContain('bg-ink') // the header Upload button's near-black
    expect(screen.getByTestId('home-upload').className).toContain('text-white')
    expect(screen.getByTestId('home-only-me').className).toContain('bg-ink/5') // black at 5%
    expect(container.innerHTML).not.toMatch(/sage|green|emerald|teal/)
  })

  it('DESKTOP (lg): the two cards share a row, equal height, in a column about 960px wide (DECISIONS #106)', () => {
    render(<SignedInHome />)
    const grid = screen.getByTestId('home-upload').parentElement!
    expect(grid).toBe(screen.getByTestId('home-only-me').parentElement) // one grid holds both
    expect(grid.className).toContain('grid')
    expect(grid.className).toContain('lg:grid-cols-2')
    expect(grid.className).toContain('lg:max-w-[960px]')
    expect(grid.className).not.toContain('items-') // no align override: the default stretch is what makes the heights equal
  })

  it('DESKTOP: Only me becomes an outlined card, Upload stays the filled near-black one', () => {
    render(<SignedInHome />)
    const only = screen.getByTestId('home-only-me').className
    expect(only).toContain('lg:border')
    expect(only).toContain('lg:border-line')
    expect(only).toContain('lg:bg-white')
    expect(only).toContain('lg:p-8') // the Upload card's padding
    expect(screen.getByTestId('home-upload').className).toContain('bg-ink')
    expect(screen.getByTestId('home-upload').className).not.toContain('lg:')
  })

  it('PHONE: below lg nothing changed, one column and the same tinted Only me row', () => {
    render(<SignedInHome />)
    const grid = screen.getByTestId('home-upload').parentElement!
    expect(grid.className).toContain('max-w-[720px]')
    expect(grid.className).toContain('gap-4') // the gap the Only me row used to get from its own top margin
    const only = screen.getByTestId('home-only-me').className
    for (const cls of ['flex', 'items-center', 'gap-3', 'rounded-card', 'bg-ink/5', 'px-4', 'py-3.5', 'hover:bg-ink/10']) expect(only.split(' ')).toContain(cls)
    expect(only.split(' ')).not.toContain('mt-4')
  })

  it('is a centred column about 720px wide', () => {
    render(<SignedInHome />)
    const column = screen.getByTestId('home-upload').parentElement!
    expect(column.className).toContain('max-w-[720px]')
    expect(column.className).toContain('mx-auto')
  })

  it('shows the review count as a white pill ON the Upload card, and none when nothing waits', async () => {
    list.mockResolvedValue([item(1, { can_resolve: true }), item(2, { can_resolve: true })])
    render(<SignedInHome />)

    const pill = await screen.findByTestId('home-review-count')
    expect(pill.textContent).toBe('2 waiting for your review')
    expect(screen.getByTestId('home-upload').contains(pill)).toBe(true) // on the card, not a separate row
    expect(pill.className).toContain('bg-white')
    expect(pill.className).toContain('text-ink')
  })

  it('shows no pill for an empty queue', async () => {
    render(<SignedInHome />)
    await waitFor(() => expect(list).toHaveBeenCalled())
    await Promise.resolve()
    expect(screen.queryByTestId('home-review-count')).toBeNull()
  })

  it('says "of your uploads" when the items wait for someone else to review them', async () => {
    auth.value = { status: 'signed-in', role: 'user' }
    list.mockResolvedValue([item(1, { can_resolve: false }), item(2, { can_resolve: false })])
    render(<SignedInHome />)
    expect((await screen.findByTestId('home-review-count')).textContent).toBe('2 of your uploads waiting for review')
  })

  it('PRIVACY: a private file never surfaces on the home, not even as a count or a name', async () => {
    auth.value = { status: 'signed-in', role: 'user' }
    list.mockResolvedValue([
      item(1, { can_resolve: true, document_visibility: 'only_me' }),
      item(2, { can_resolve: true, document_visibility: 'only_me' }),
    ])
    const { container } = render(<SignedInHome />)
    await waitFor(() => expect(list).toHaveBeenCalled())
    await Promise.resolve()

    expect(screen.queryByTestId('home-review-count')).toBeNull()
    expect(container.textContent).not.toMatch(/secret-|very private/)
  })

  it('a private file among company items is left out of the number', async () => {
    list.mockResolvedValue([item(1, { can_resolve: true }), item(2, { can_resolve: true, document_visibility: 'only_me' })])
    render(<SignedInHome />)
    expect((await screen.findByTestId('home-review-count')).textContent).toBe('1 waiting for your review')
  })

  it('reads in the chosen language', async () => {
    await i18n.changeLanguage('ms')
    list.mockResolvedValue([item(1, { can_resolve: true })])
    render(<SignedInHome />)
    expect((await screen.findByTestId('home-review-count')).textContent).toBe('1 menunggu semakan anda')
    expect(within(screen.getByTestId('home-upload')).getByText('Muat naik')).toBeTruthy()
  })
})
