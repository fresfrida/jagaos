/** The signed-in home hub (round 20, item 2, final ruling): a dominant Upload card and a quieter Only me
 * card of the same shape (DECISIONS #118), in black, white and tints of black; nothing embedded; private files never surface here. */

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

  it('DESKTOP: Only me becomes an outlined card, Upload stays the filled near-black one, and both have the same padding', () => {
    render(<SignedInHome />)
    const only = screen.getByTestId('home-only-me').className
    expect(only).toContain('lg:border')
    expect(only).toContain('lg:border-line')
    expect(only).toContain('lg:bg-white')
    const upload = screen.getByTestId('home-upload').className
    expect(upload).toContain('bg-ink')
    expect(upload).not.toContain('lg:')
    for (const cls of ['p-6', 'sm:p-8']) {
      expect(only.split(' '), cls).toContain(cls) // the Upload card's padding, at every width now (DECISIONS #118)
      expect(upload.split(' '), cls).toContain(cls)
    }
  })

  it('PHONE (and every width): Only me is Upload\'s shape, in equal rows, not the shorter horizontal row of #108 (DECISIONS #118)', () => {
    render(<SignedInHome />)
    const grid = screen.getByTestId('home-upload').parentElement!
    expect(grid.className).toContain('max-w-[720px]')
    expect(grid.className).toContain('gap-4')
    expect(grid.className).toContain('auto-rows-fr') // equal rows: both cards as tall as the taller one, with or without the pill, in any language
    expect(grid.className).not.toContain('grid-rows-[3fr_2fr]') // #108's two thirds is gone
    expect(grid.className).not.toContain('lg:grid-rows-none')
    const only = screen.getByTestId('home-only-me').className.split(' ')
    for (const cls of ['block', 'rounded-card', 'bg-ink/5', 'p-6', 'sm:p-8', 'hover:bg-ink/10']) expect(only, cls).toContain(cls)
    for (const cls of ['flex', 'items-center', 'px-5', 'py-4', 'gap-3']) expect(only, cls).not.toContain(cls) // the old horizontal row
  })

  it('Only me has the SAME internal arrangement as Upload: the icon on its own line, then the title, then the description, the chevron at the top right', () => {
    render(<SignedInHome />)
    const skeleton = (testId: string) => {
      const row = screen.getByTestId(testId).firstElementChild as HTMLElement // the flex row: text block and chevron
      const [textBlock, chevron] = [...row.children] as HTMLElement[]
      const [icon, title, hint] = [...textBlock!.children] as HTMLElement[]
      return {
        row: row.className,
        textBlock: textBlock!.className,
        order: [...textBlock!.children].map((c) => c.tagName.toLowerCase()),
        iconIsSvg: icon!.tagName.toLowerCase() === 'svg',
        title: title!.className.split(' ').filter((c) => !c.startsWith('text-white') && c !== 'text-ink'),
        hint: hint!.className.split(' ').filter((c) => !c.startsWith('text-white') && c !== 'text-muted'),
        chevron: chevron!.getAttribute('class')!.split(' ').filter((c) => c !== 'text-muted'),
      }
    }
    const upload = skeleton('home-upload')
    const only = skeleton('home-only-me')
    expect(only.order).toEqual(['svg', 'span', 'span'])
    expect(only.order).toEqual(upload.order)
    expect(only.row).toBe(upload.row) // flex items-start justify-between gap-4
    expect(only.textBlock).toBe(upload.textBlock)
    expect(only.title).toEqual(upload.title) // mt-4 block text-2xl font-semibold sm:text-3xl
    expect(only.hint).toEqual(upload.hint) // mt-1.5 block text-[16px] leading-6
    expect(only.chevron.filter((c) => c !== 'group-hover:translate-x-0.5' && c !== 'transition-transform')).toEqual(upload.chevron.filter((c) => c !== 'group-hover:translate-x-0.5' && c !== 'transition-transform'))
  })

  it('DESKTOP: the container grows into the space the shell gives the page and centres the cards in it, vertically (DECISIONS #109)', () => {
    const { container } = render(<SignedInHome />)
    const root = container.firstElementChild!
    for (const cls of ['lg:flex', 'lg:flex-1', 'lg:items-center']) expect(root.className, cls).toContain(cls)
    expect(screen.getByTestId('home-upload').parentElement!.className).toContain('lg:w-full') // a flex item must be told to fill its column
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
