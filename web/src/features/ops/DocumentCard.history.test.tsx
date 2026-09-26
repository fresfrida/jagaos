/** The Company Files card's History panel (round 6, DECISIONS #129). It replaced the AI trace in the SAME per-card expandable panel:
 * same place, same shell, same lazy fetch. What is inside is what people did to the document, in plain language, oldest first.
 * The old panel's content (AI nodes, models, extracted fields, tokens, costs, raw trace) and its "AI trace" wording must be gone from
 * everything a person can see, in every language. These tests pin that, plus the loading/error/empty states. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { DocumentCard } from './DocumentCard'
import { HistoryPanel } from './HistoryPanel'
import { opsApi, type DocumentActivityEntry, type DocumentRow } from './opsApi'

vi.mock('./opsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./opsApi')>()
  return { ...actual, opsApi: { ...actual.opsApi, getDocumentHistory: vi.fn() } }
})

const base: DocumentRow = {
  id: 7, filename: 'lease.txt', media_type: 'text/plain', lane: 'important', doc_type: 'lease', status: 'filed', received_at: '2026-09-23 06:14:00',
  description: JSON.stringify({ en: 'Office lease' }), bucket: 'Contracts', vendor_name: null, occurred_on: null, can_edit: true,
  activity_summary: { count: 3 },
}

const ENTRIES: DocumentActivityEntry[] = [
  { action: 'uploaded', actor_name: 'Frida', at: '2026-09-23 06:14:00' },
  { action: 'edited', actor_name: 'Aisha', at: '2026-09-24 01:05:00' },
  { action: 'purge_requested', actor_name: 'Frida', at: '2026-09-25 09:30:00' },
]

const show = (doc: DocumentRow = base) =>
  render(<DocumentCard doc={doc} canEdit canArchive canRequestPurge onView={vi.fn()} onArchive={vi.fn()} onRequestPurge={vi.fn()} onCancelPurge={vi.fn()} onSaved={vi.fn()} />)

const trigger = () => screen.getByRole('button', { name: /^history/i })
const getHistory = vi.mocked(opsApi.getDocumentHistory)

beforeEach(async () => {
  getHistory.mockReset()
  getHistory.mockResolvedValue({ entries: ENTRIES })
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

/** Everything the old panel showed, and its name. None of it may appear on the card, collapsed or expanded. */
const AI_TRACE_VOCABULARY = [/ai trace/i, /\bmodel\b/i, /\btokens?\b/i, /\bcost\b/i, /raw trace/i, /extracted/i, /\bnode\b/i, /classify/i, /sonnet/i, /\$\d/]

describe('History replaces the AI trace in the card\'s expandable panel', () => {
  it('collapsed: a "History · N activities" trigger with the summary count, expanded=false, and no AI trace wording anywhere', () => {
    show()
    expect(trigger().textContent).toBe('History · 3 activities')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('history-panel')).toBeNull()
    expect(getHistory).not.toHaveBeenCalled() // lazy: the full list is fetched only when this card's panel is opened
    for (const word of AI_TRACE_VOCABULARY) expect(document.body.textContent, String(word)).not.toMatch(word)
  })

  it('one activity is singular; no activity says so plainly; an older API answer with no summary at all is treated as none', () => {
    show({ ...base, activity_summary: { count: 1 } })
    expect(trigger().textContent).toBe('History · 1 activity')
    cleanup()
    show({ ...base, activity_summary: { count: 0 } })
    expect(trigger().textContent).toBe('History · 0 activities')
    cleanup()
    show({ ...base, activity_summary: null })
    expect(trigger().textContent).toBe('History · no activity')
  })

  it('opens in place and lists who did what and when, oldest first, in plain language with the company timezone', async () => {
    show()
    fireEvent.click(trigger())
    const panel = await screen.findByTestId('history-panel')
    expect(getHistory).toHaveBeenCalledWith(7)
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    const rows = within(panel).getAllByRole('listitem').map((li) => li.textContent)
    // 06:14 UTC is 2:14pm in Singapore (the default company timezone); the API's timestamps are UTC with no zone suffix.
    expect(rows).toEqual([
      'Uploaded by Frida23 Sept 2026, 2:14 pm',
      'Edited by Aisha24 Sept 2026, 9:05 am',
      'Purge requested by Frida25 Sept 2026, 5:30 pm',
    ])
    for (const word of AI_TRACE_VOCABULARY) expect(document.body.textContent, String(word)).not.toMatch(word)
  })

  it('never renders an internal action code or a raw timestamp', async () => {
    show()
    fireEvent.click(trigger())
    const panel = await screen.findByTestId('history-panel')
    for (const raw of ['purge_requested', 'purge_cancelled', 'uploaded', '2026-09-23', 'T06:14']) expect(panel.textContent).not.toContain(raw)
  })

  it('a second tap collapses it, and reopening does not fetch again', async () => {
    show()
    fireEvent.click(trigger())
    await screen.findByTestId('history-panel')
    fireEvent.click(trigger())
    expect(screen.queryByTestId('history-panel')).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger())
    await screen.findByTestId('history-panel')
    expect(getHistory).toHaveBeenCalledTimes(1)
  })

  it('shows a loading line while the history is on its way', async () => {
    getHistory.mockReturnValue(new Promise(() => {}))
    show()
    fireEvent.click(trigger())
    expect(await screen.findByText('Loading history…')).toBeTruthy()
  })

  it('shows a visible, plain error (not the raw exception) when the history cannot be loaded, and retries on the next open', async () => {
    getHistory.mockRejectedValueOnce(new Error('HTTP 500 sqlite3.OperationalError'))
    show()
    fireEvent.click(trigger())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Couldn\'t load the history. Close it and try again.')
    expect(document.body.textContent).not.toContain('sqlite3')
    fireEvent.click(trigger())
    fireEvent.click(trigger())
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(await screen.findByTestId('history-panel')).toBeTruthy()
    expect(getHistory).toHaveBeenCalledTimes(2)
  })

  it('an empty history says so instead of drawing an empty box', async () => {
    getHistory.mockResolvedValue({ entries: [] })
    show({ ...base, activity_summary: { count: 0 } })
    fireEvent.click(trigger())
    expect((await screen.findByTestId('history-panel')).textContent).toBe('No activity has been recorded for this document.')
  })

  it('a document waiting for purge keeps its History, live and openable (never gated on purge-pending)', async () => {
    show({ ...base, status: 'purge_requested' })
    expect(trigger().hasAttribute('disabled')).toBe(false)
    fireEvent.click(trigger())
    expect(await screen.findByTestId('history-panel')).toBeTruthy()
  })
})

describe('History in every language', () => {
  const NAME = 'Frida'
  const all: DocumentActivityEntry[] = [
    { action: 'uploaded', actor_name: NAME, at: '2026-09-23 06:14:00' },
    { action: 'edited', actor_name: NAME, at: '2026-09-23 07:00:00' },
    { action: 'purge_requested', actor_name: NAME, at: '2026-09-23 08:00:00' },
    { action: 'purge_cancelled', actor_name: NAME, at: '2026-09-23 09:00:00' },
    { action: 'deleted', actor_name: NAME, at: '2026-09-23 10:00:00' },
  ]

  it.each(['en', 'ms', 'zh', 'ta'])('%s: every action reads as a sentence naming the person, with no internal code and no English leakage in the other languages', async (lang) => {
    await i18n.changeLanguage(lang)
    render(<HistoryPanel entries={all} />)
    const rows = within(screen.getByTestId('history-panel')).getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row).toContain(NAME)
      expect(row).not.toMatch(/purge_|uploaded|deleted|edited|undefined|null|\{\{/)
    }
    if (lang !== 'en') for (const row of rows) expect(row).not.toMatch(/\b(?:Uploaded|Edited|Deleted|requested|cancelled)\b/)
    // five different actions read five different ways
    expect(new Set(rows.map((r) => r.replace(/\d.*$/, '')))).toHaveProperty('size', 5)
  })

  it.each(['en', 'ms', 'zh', 'ta'])('%s: the collapsed line is localized and plural-aware', async (lang) => {
    await i18n.changeLanguage(lang)
    // The trigger is the card's only aria-expanded control, so it can be found without its (localized) name.
    const summaryLine = () => screen.getByRole('button', { expanded: false }).textContent
    const { unmount } = show({ ...base, activity_summary: { count: 1 } })
    const one = summaryLine()
    unmount()
    show({ ...base, activity_summary: { count: 4 } })
    const many = summaryLine()
    expect(one).toContain('1')
    expect(many).toContain('4')
    expect(`${one}${many}`).not.toMatch(/ops\.documents|history\.summary|\{\{/)
    if (lang === 'en') { expect(one).toBe('History · 1 activity'); expect(many).toBe('History · 4 activities') }
  })
})

describe('HistoryPanel on its own', () => {
  it('names an actor the server could not name as "an unknown user" rather than printing null', () => {
    render(<HistoryPanel entries={[{ action: 'uploaded', actor_name: null, at: '2026-09-23 06:14:00' }, { action: 'deleted', actor_name: '   ', at: '2026-09-23 07:14:00' }]} />)
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(rows[0]).toContain('Uploaded by an unknown user')
    expect(rows[1]).toContain('Deleted by an unknown user')
    expect(document.body.textContent).not.toMatch(/null|undefined/)
  })

  it('an action this build does not know yet degrades to a generic sentence, never the raw code', () => {
    render(<HistoryPanel entries={[{ action: 'renamed' as never, actor_name: 'Frida', at: '2026-09-23 06:14:00' }]} />)
    const row = screen.getByRole('listitem').textContent ?? ''
    expect(row).toContain('Activity by Frida')
    expect(row).not.toContain('renamed')
  })
})

describe('the business title beside the name (round 7, S3, DECISIONS #136)', () => {
  const titled = (over: Partial<DocumentActivityEntry> = {}): DocumentActivityEntry => ({
    action: 'uploaded', actor_name: 'Rachel Tan', actor_title: 'Corp Sec', at: '2026-09-23 06:14:00', ...over,
  })
  const rows = () => within(screen.getByTestId('history-panel')).getAllByRole('listitem').map((li) => li.textContent ?? '')

  it('shows the title in brackets after the name, in the sentence: "Uploaded by Rachel Tan (Corp Sec)"', () => {
    render(<HistoryPanel entries={[titled()]} />)
    expect(rows()[0]).toContain('Uploaded by Rachel Tan (Corp Sec)')
  })

  it('shows the title exactly as stored: free text, an ampersand is not escaped, and it is not translated in any language', async () => {
    for (const lang of ['en', 'ms', 'zh', 'ta']) {
      await i18n.changeLanguage(lang)
      const { unmount } = render(<HistoryPanel entries={[titled({ actor_title: 'HR & Finance Manager' })]} />)
      expect(rows()[0], lang).toContain('HR & Finance Manager')
      expect(rows()[0], lang).not.toMatch(/&amp;|\{\{|history\./)
      unmount()
    }
  })

  it('uses the language\'s own brackets around it (full-width in Chinese)', async () => {
    await i18n.changeLanguage('zh')
    render(<HistoryPanel entries={[titled()]} />)
    expect(rows()[0]).toContain('Rachel Tan（Corp Sec）')
  })

  it('shows just the name when there is no title: null, blank, or the field missing altogether (an older backend)', () => {
    const noField = { action: 'edited', actor_name: 'Jonathan Ong', at: '2026-09-24 01:05:00' } as DocumentActivityEntry
    render(<HistoryPanel entries={[titled({ actor_title: null }), titled({ actor_title: '   ' }), noField]} />)
    const text = rows()
    expect(text[0]).toContain('Uploaded by Rachel Tan')
    expect(text[0]).not.toContain('(')
    expect(text[1]).not.toContain('(')
    expect(text[2]).toContain('Edited by Jonathan Ong')
    expect(text[2]).not.toContain('(')
  })

  it('never puts a title on an unknown actor, and never prints "null" or "undefined"', () => {
    render(<HistoryPanel entries={[titled({ actor_name: null, actor_title: 'Corp Sec' }), titled({ actor_name: '  ', actor_title: 'Corp Sec' })]} />)
    for (const row of rows()) {
      expect(row).toContain('Uploaded by an unknown user')
      expect(row).not.toMatch(/Corp Sec|null|undefined/)
    }
  })

  it('reaches the card: an expanded History carries the title the API returned', async () => {
    getHistory.mockResolvedValue({ entries: [titled(), titled({ action: 'edited', actor_name: 'Jonathan Ong', actor_title: 'HR & Finance Manager', at: '2026-09-24 01:05:00' })] })
    show()
    fireEvent.click(trigger())
    const panel = await screen.findByTestId('history-panel')
    const text = within(panel).getAllByRole('listitem').map((li) => li.textContent)
    expect(text[0]).toContain('Uploaded by Rachel Tan (Corp Sec)')
    expect(text[1]).toContain('Edited by Jonathan Ong (HR & Finance Manager)')
  })
})
