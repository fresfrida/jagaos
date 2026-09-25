/** What the Calendar keeps of the compliance checklist (round 21, A2, DECISIONS #101): a one-line count, linking to Company
 * Settings for the roles that can open it. */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import type { Expectation } from '../ops/opsApi'
import { ChecklistSummary } from './ChecklistSummary'

const row = (id: number, status: string): Expectation => ({ id, doc_type: 'constitution', label: `Item ${id}`, status, evidence_document_id: null } as Expectation)
const ROWS = [row(1, 'satisfied'), row(2, 'missing'), row(3, 'satisfied'), row(4, 'waived'), row(5, 'missing')]

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

describe('ChecklistSummary', () => {
  it('says how many of the expected documents are held, and lists none of them', () => {
    render(<ChecklistSummary expectations={ROWS} canOpen />)
    expect(screen.getByTestId('checklist-summary').textContent).toContain('Compliance checklist: 2 of 5 held')
    expect(screen.queryByText('Item 2')).toBeNull()
  })

  it('links admin and owner to Company Settings', () => {
    render(<ChecklistSummary expectations={ROWS} canOpen />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/company-settings')
    expect(link.textContent).toContain('Open the full checklist in Company Settings')
  })

  it('shows the count without a link to anyone who could not open it: it would only send them back here', () => {
    render(<ChecklistSummary expectations={ROWS} canOpen={false} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByTestId('checklist-summary').textContent).toContain('2 of 5 held')
    expect(screen.queryByText(/Company Settings/)).toBeNull()
  })

  it('an empty checklist reads 0 of 0', () => {
    render(<ChecklistSummary expectations={[]} canOpen={false} />)
    expect(screen.getByTestId('checklist-summary').textContent).toContain('0 of 0 held')
  })
})
