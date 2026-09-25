/** Company Files' filters (round 21, DECISIONS #101): the bucket buttons with an "All" that clears them (A6), and a from/to date
 * range over the upload or the document date (A7). They combine: a document must match both. And the owner's Purge (A5). */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'

const auth = vi.hoisted(() => ({
  value: { status: 'signed-in', role: 'owner', company: { timezone: 'Asia/Singapore' } } as { status: string; role: string | null; company: { timezone: string } | null },
}))
vi.mock('../features/auth/AuthContext', () => ({ useAuth: () => auth.value }))
const ops = vi.hoisted(() => ({ documents: [] as unknown[], refresh: vi.fn() }))
vi.mock('../features/ops/useOpsData', () => ({
  useOpsData: () => ({ documents: ops.documents, apiUp: true, error: null, refresh: ops.refresh }),
}))
vi.mock('../features/ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../features/ops/opsApi')>()),
  opsApi: { requestPurge: vi.fn(), archiveDocument: vi.fn(), getTrace: vi.fn() },
}))

import { opsApi, type DocumentRow } from '../features/ops/opsApi'
import { CompanyFilesPage } from './CompanyFilesPage'

const doc = (id: number, over: Partial<DocumentRow> = {}): DocumentRow => ({
  id, filename: `file-${id}.txt`, media_type: 'text/plain', lane: 'invoice', doc_type: 'invoice', status: 'filed',
  received_at: '2026-03-10 03:00:00', description: JSON.stringify({ en: `Doc ${id}` }), bucket: 'Expenses', vendor_name: null,
  occurred_on: null, can_edit: true, ...over,
})
const DOCS = [
  doc(1, { bucket: 'Expenses', received_at: '2026-01-10 03:00:00', occurred_on: '2025-12-30' }),
  doc(2, { bucket: 'Expenses', received_at: '2026-02-15 03:00:00', occurred_on: '2026-02-01' }),
  doc(3, { bucket: 'Statutory', received_at: '2026-03-20 03:00:00', occurred_on: null }),
  doc(4, { bucket: 'Statutory', received_at: '2026-04-05 03:00:00', occurred_on: '2026-04-05' }),
]

const shown = () => screen.queryAllByText(/^Doc \d$/).map((n) => n.textContent)
const button = (name: RegExp | string) => screen.getByRole('button', { name })

beforeEach(async () => {
  vi.resetAllMocks()
  auth.value = { status: 'signed-in', role: 'owner', company: { timezone: 'Asia/Singapore' } }
  ops.documents = DOCS
  window.history.replaceState({}, '', '/company-files')
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('Company Files: the All button (A6)', () => {
  it('sits with the bucket buttons, is selected while no bucket is, and counts every document', () => {
    render(<CompanyFilesPage />)
    const all = button('All (4)')
    expect(all.getAttribute('aria-pressed')).toBe('true')
    expect(shown()).toEqual(['Doc 1', 'Doc 2', 'Doc 3', 'Doc 4'])
    expect(button(/Expenses \(2\)/).getAttribute('aria-pressed')).toBe('false')
  })

  it('choosing a bucket narrows the list, and All brings everything back and is selected again', () => {
    render(<CompanyFilesPage />)

    fireEvent.click(button(/Statutory \(2\)/))
    expect(shown()).toEqual(['Doc 3', 'Doc 4'])
    expect(button('All (4)').getAttribute('aria-pressed')).toBe('false')
    expect(button(/Statutory \(2\)/).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(button('All (4)'))
    expect(shown()).toEqual(['Doc 1', 'Doc 2', 'Doc 3', 'Doc 4'])
    expect(button('All (4)').getAttribute('aria-pressed')).toBe('true')
    expect(button(/Statutory \(2\)/).getAttribute('aria-pressed')).toBe('false')
  })

  it('pressing the chosen bucket again still clears it, as before', () => {
    render(<CompanyFilesPage />)
    fireEvent.click(button(/Expenses/))
    fireEvent.click(button(/Expenses/))
    expect(shown()).toHaveLength(4)
  })

  it('arriving from the Tags page with ?bucket= starts filtered, and All undoes it', () => {
    window.history.replaceState({}, '', '/company-files?bucket=Statutory')
    render(<CompanyFilesPage />)
    expect(shown()).toEqual(['Doc 3', 'Doc 4'])
    fireEvent.click(button('All (4)'))
    expect(shown()).toHaveLength(4)
  })
})

describe('Company Files: the date range (A7)', () => {
  const setRange = (from: string, to: string) => {
    fireEvent.change(screen.getByLabelText('From'), { target: { value: from } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: to } })
  }

  it('narrows the list to the documents uploaded inside it, and the counts follow', () => {
    render(<CompanyFilesPage />)

    setRange('2026-02-01', '2026-03-31')

    expect(shown()).toEqual(['Doc 2', 'Doc 3'])
    expect(button('All (2)')).toBeTruthy()
    expect(button(/Expenses \(1\)/)).toBeTruthy()
    expect(button(/Statutory \(1\)/)).toBeTruthy()
    expect(screen.getByText('Documents (2)')).toBeTruthy()
  })

  it('on Document dates it uses the date the document carries, and leaves out a document with none', () => {
    render(<CompanyFilesPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Document dates' }))

    setRange('2026-01-01', '2026-12-31')

    expect(shown()).toEqual(['Doc 2', 'Doc 4']) // Doc 1's date is 2025, Doc 3 has none
  })

  it('combines with the bucket: a document must match both', () => {
    render(<CompanyFilesPage />)
    setRange('2026-02-01', '2026-04-30')
    fireEvent.click(button(/Statutory \(2\)/))
    expect(shown()).toEqual(['Doc 3', 'Doc 4'])

    setRange('2026-04-01', '2026-04-30')
    expect(shown()).toEqual(['Doc 4'])
    fireEvent.click(button(/Expenses \(0\)/))
    expect(shown()).toEqual([])
    expect(screen.getByText('No documents match these filters.')).toBeTruthy() // not "No documents uploaded yet."
  })

  it('reads the upload day in the COMPANY timezone', () => {
    ops.documents = [doc(1, { received_at: '2026-03-31 20:00:00' })] // 04:00 on 1 April in Singapore
    render(<CompanyFilesPage />)
    setRange('2026-04-01', '2026-04-01')
    expect(shown()).toEqual(['Doc 1'])
    auth.value = { ...auth.value, company: { timezone: 'UTC' } }
    cleanup()
    render(<CompanyFilesPage />)
    setRange('2026-04-01', '2026-04-01')
    expect(shown()).toEqual([])
  })

  it('a backwards range says so and shows nothing; Clear dates brings everything back', () => {
    render(<CompanyFilesPage />)
    setRange('2026-05-01', '2026-01-01')
    expect(screen.getByRole('alert').textContent).toBe('The start date is after the end date.')
    expect(shown()).toEqual([])

    fireEvent.click(screen.getByRole('button', { name: 'Clear dates' }))
    expect(shown()).toHaveLength(4)
  })

  it('starts from ?from=&to=&basis= (a link from the Tags page), and ignores a junk value', () => {
    window.history.replaceState({}, '', '/company-files?from=2026-02-01&to=2026-03-31&basis=upload')
    render(<CompanyFilesPage />)
    expect(shown()).toEqual(['Doc 2', 'Doc 3'])
    expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('2026-02-01')
    cleanup()

    window.history.replaceState({}, '', '/company-files?from=nonsense&basis=filed')
    render(<CompanyFilesPage />)
    expect(shown()).toHaveLength(4)
  })

  it('with no documents at all it still says none were uploaded', () => {
    ops.documents = []
    render(<CompanyFilesPage />)
    expect(screen.getByText('No documents uploaded yet.')).toBeTruthy()
  })
})

describe('Company Files: the owner\'s Purge (A5)', () => {
  it('is offered on each company document to the owner only; an admin has Delete and no Purge', () => {
    render(<CompanyFilesPage />)
    expect(screen.getAllByRole('button', { name: 'Purge' })).toHaveLength(4)
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(4)
    cleanup()

    for (const role of ['admin', 'user', 'viewer']) {
      auth.value = { ...auth.value, role }
      render(<CompanyFilesPage />)
      expect(screen.queryByRole('button', { name: 'Purge' }), role).toBeNull()
      cleanup()
    }
    auth.value = { ...auth.value, role: 'admin' }
    render(<CompanyFilesPage />)
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(4)
  })

  it('asks first, says what everyone else and the owner will see, requests the purge, reloads the list and confirms by name', async () => {
    vi.mocked(opsApi.requestPurge).mockResolvedValue({ status: 'purge_requested' })
    render(<CompanyFilesPage />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Purge' })[0]!)
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/permanently removed/)).toBeTruthy()
    expect(within(dialog).getByText(/Everyone else stops seeing it now/)).toBeTruthy()
    expect(within(dialog).getByText(/You keep seeing it, marked "Purge requested", until the team removes it permanently/)).toBeTruthy()
    expect(opsApi.requestPurge).not.toHaveBeenCalled() // asking is not doing

    fireEvent.click(within(dialog).getByRole('button', { name: 'Purge' }))

    await waitFor(() => expect(opsApi.requestPurge).toHaveBeenCalledWith(1))
    await waitFor(() => expect(ops.refresh).toHaveBeenCalled())
    expect((await screen.findByRole('status')).textContent).toContain('Purge requested for "file-1.txt". Everyone else no longer sees it. It stays here, marked, until the team removes it permanently.')
    expect(opsApi.archiveDocument).not.toHaveBeenCalled()
  })

  it('cancelling asks for nothing', () => {
    render(<CompanyFilesPage />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Purge' })[0]!)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }))
    expect(opsApi.requestPurge).not.toHaveBeenCalled()
  })

  it('a refused request shows the server message and confirms nothing', async () => {
    vi.mocked(opsApi.requestPurge).mockRejectedValue(new Error('Only the owner can request that a company document be purged'))
    render(<CompanyFilesPage />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Purge' })[0]!)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Purge' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Only the owner')
    expect(screen.queryByText(/is hidden now/)).toBeNull()
  })
})


describe('Company Files: a purge the owner asked for stays visible to them until the team removes it (DECISIONS #102)', () => {
  const requested = () => doc(5, {
    status: 'purge_requested', can_edit: false, description: JSON.stringify({ en: 'Doc 5' }),
  })

  it('shows the document with a "Purge requested" pill and the line saying the team removes it', () => {
    ops.documents = [...DOCS, requested()]
    render(<CompanyFilesPage />)
    const card = screen.getByText('Doc 5').closest('div.p-4') as HTMLElement
    expect(within(card).getByText('Purge requested')).toBeTruthy()
    expect(within(card).getByTestId('purge-pending-note').textContent).toBe('Purge requested: the team removes it permanently.')
    expect(shown()).toContain('Doc 5')
  })

  it('leaves View and nothing else: no Edit, no Delete, no Purge, no more-actions menu', () => {
    ops.documents = [requested()]
    render(<CompanyFilesPage />)
    const card = screen.getByText('Doc 5').closest('div.p-4') as HTMLElement
    expect(within(card).getByRole('button', { name: /^view$/i })).toBeTruthy()
    for (const name of [/^edit$/i, /^delete$/i, /^purge$/i, /more actions/i]) expect(within(card).queryByRole('button', { name }), String(name)).toBeNull()
  })

  it('the other documents beside it keep their own actions', () => {
    ops.documents = [...DOCS, requested()]
    render(<CompanyFilesPage />)
    expect(screen.getAllByRole('button', { name: 'Purge' })).toHaveLength(4)
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(4)
  })

  it('counts with the rest', () => {
    ops.documents = [...DOCS, requested()]
    render(<CompanyFilesPage />)
    expect(screen.getByText('Documents (5)')).toBeTruthy()
  })
})

describe('Company Files: arriving from a Calendar day-list row with ?doc= (DECISIONS #105)', () => {
  // jsdom has no scrollIntoView; a stub that records which element it was called on stands in for the browser's.
  const scrollIntoView = vi.fn()
  beforeEach(() => {
    scrollIntoView.mockReset()
    Element.prototype.scrollIntoView = scrollIntoView
  })
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  })

  const ringed = () => document.querySelector('[aria-current="true"]')

  it('rings that document\'s card and scrolls it to the middle, with no filter set', () => {
    window.history.replaceState({}, '', '/company-files?doc=3')
    render(<CompanyFilesPage />)

    expect(shown()).toEqual(['Doc 1', 'Doc 2', 'Doc 3', 'Doc 4']) // nothing filtered out: the target is always in the list
    expect(ringed()).toBe(screen.getByText('Doc 3').closest('[aria-current]'))
    expect(ringed()?.className).toContain('ring-2')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(ringed())
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  })

  it('scrolls when the list ARRIVES (it loads after the page mounts), and only once, not on every refetch', () => {
    window.history.replaceState({}, '', '/company-files?doc=2')
    ops.documents = []
    const { rerender } = render(<CompanyFilesPage />)
    expect(scrollIntoView).not.toHaveBeenCalled()

    ops.documents = DOCS
    rerender(<CompanyFilesPage />)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    ops.documents = [...DOCS] // a refresh returns a new array with the same documents
    rerender(<CompanyFilesPage />)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('a document that is not in the list (archived meanwhile) or a junk id highlights nothing and does not break the page', () => {
    for (const href of ['/company-files?doc=99', '/company-files?doc=abc', '/company-files']) {
      window.history.replaceState({}, '', href)
      const { unmount } = render(<CompanyFilesPage />)
      expect(shown()).toHaveLength(4)
      expect(ringed(), href).toBeNull()
      unmount()
    }
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
