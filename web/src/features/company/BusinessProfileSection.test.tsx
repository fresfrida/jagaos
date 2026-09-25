/** Round 16, item 6: the Business profile row in Company Settings and the
 * confirmation shown before a profile is laid over the form. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

vi.mock('../ops/DocumentCard', () => ({
  DocumentThumbnail: () => <span data-testid="thumbnail" />,
  DocumentViewerModal: ({ doc, onClose }: { doc: { filename: string }; onClose: () => void }) => (
    <div role="dialog" aria-label={`viewer ${doc.filename}`}><button onClick={onClose}>close viewer</button></div>
  ),
}))

import type { BusinessProfileDocument } from '../auth/authApi'
import { BusinessProfileSection } from './BusinessProfileSection'
import { PrefillConfirmSheet } from './PrefillConfirmSheet'
import type { PrefillChange } from './companyForm'
import type { BusinessProfileState, UploadNotice } from './useBusinessProfile'

const profileDoc = (over: Partial<BusinessProfileDocument> = {}): BusinessProfileDocument => ({
  id: 7, filename: 'bizfile.pdf', media_type: 'application/pdf', status: 'filed', received_at: '2026-09-24 05:00:00', can_prefill: true, ...over,
})

const make = (state: BusinessProfileState, extra: Partial<{ uploading: { name: string } | null; notice: UploadNotice | null; removing: boolean }> = {}) => ({
  state, uploading: null, notice: null, removing: false,
  upload: vi.fn(), remove: vi.fn(), reload: vi.fn(),
  ...extra,
})

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

describe('BusinessProfileSection', () => {
  it('with no profile, the row is the upload button, styled as the Upload page choices', () => {
    render(<BusinessProfileSection profile={make({ status: 'ready', document: null })} onFill={vi.fn()} fillBusy={false} />)
    const row = screen.getByRole('button', { name: /business profile/i })
    expect(row.textContent).toContain('Upload it to fill in the details below.')
    expect(row.className).toContain('group flex w-full items-center gap-4') // the shared ChoiceRow classes
  })

  it('picking a file uploads it through the hook', () => {
    const profile = make({ status: 'ready', document: null })
    render(<BusinessProfileSection profile={profile} onFill={vi.fn()} fillBusy={false} />)
    const file = new File(['%PDF'], 'bizfile.pdf', { type: 'application/pdf' })

    fireEvent.change(screen.getByTestId('business-profile-input'), { target: { files: [file] } })

    expect(profile.upload).toHaveBeenCalledWith(file)
  })

  it('a pending profile shows its state, a link to the review queue, and cannot yet fill the form', () => {
    render(<BusinessProfileSection profile={make({ status: 'ready', document: profileDoc({ status: 'needs_review', can_prefill: false }) })} onFill={vi.fn()} fillBusy={false} />)
    expect(screen.getByText('Waiting for you to confirm what we read.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open the review queue' }).getAttribute('href')).toBe('/upload')
    expect(screen.queryByRole('button', { name: 'Fill in the form' })).toBeNull()
    expect(screen.getByTestId('thumbnail')).toBeTruthy()
  })

  it('a confirmed profile can fill the form, be replaced, or be removed after a confirmation', () => {
    const profile = make({ status: 'ready', document: profileDoc() })
    const onFill = vi.fn()
    render(<BusinessProfileSection profile={profile} onFill={onFill} fillBusy={false} />)

    expect(screen.getByText('Confirmed. Ready to fill in the form.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Fill in the form' }))
    expect(onFill).toHaveBeenCalledWith(7)

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(profile.remove).not.toHaveBeenCalled() // asked first
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }))
    expect(profile.remove).toHaveBeenCalledWith(7)
  })

  it('the thumbnail opens the lightbox from inside the section', () => {
    render(<BusinessProfileSection profile={make({ status: 'ready', document: profileDoc() })} onFill={vi.fn()} fillBusy={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'View the business profile' }))
    expect(screen.getByRole('dialog', { name: 'viewer bizfile.pdf' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'close viewer' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the file being read while an upload is under way, and no other row', () => {
    render(<BusinessProfileSection profile={make({ status: 'ready', document: null }, { uploading: { name: 'bizfile.pdf' } })} onFill={vi.fn()} fillBusy={false} />)
    expect(screen.getByRole('status').textContent).toContain('Reading your document')
    expect(screen.queryByRole('button', { name: /business profile/i })).toBeNull()
  })

  it.each<[UploadNotice, RegExp]>([
    ['uploaded', /confirm what we read in the review queue/i],
    ['notAProfile', /didn't look like a business profile/i],
    ['duplicate', /already uploaded/i],
    ['quarantined', /blocked for a safety check/i],
    ['failed', /didn't work/i],
  ])('says what happened after an upload: %s', (notice, text) => {
    render(<BusinessProfileSection profile={make({ status: 'ready', document: null }, { notice })} onFill={vi.fn()} fillBusy={false} />)
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('is not shown at all against a backend that predates the endpoint', () => {
    const { container } = render(<BusinessProfileSection profile={make({ status: 'unavailable' })} onFill={vi.fn()} fillBusy={false} />)
    expect(container.textContent).toBe('')
  })

  it('says so when it could not check, instead of offering an upload it could not show', () => {
    render(<BusinessProfileSection profile={make({ status: 'failed' })} onFill={vi.fn()} fillBusy={false} />)
    expect(screen.getByRole('alert').textContent).toContain("Couldn't check")
    expect(screen.queryByRole('button', { name: /business profile/i })).toBeNull()
  })
})

describe('PrefillConfirmSheet', () => {
  const changes: PrefillChange[] = [
    { field: 'name', before: 'Old Name Pte Ltd', after: 'New Name Pte Ltd' },
    { field: 'uen', before: '', after: '202412345K' },
    { field: 'gstRegistered', before: false, after: true },
  ]

  it('lists each field with what it holds now and what the profile would put there', () => {
    render(<PrefillConfirmSheet open changes={changes} onApply={vi.fn()} onCancel={vi.fn()} />)
    const list = screen.getByTestId('prefill-changes')
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]!.textContent).toContain('Company name')
    expect(items[0]!.textContent).toContain('Old Name Pte Ltd')
    expect(items[0]!.textContent).toContain('New Name Pte Ltd')
    expect(items[1]!.textContent).toContain('(empty)') // a blank old value is said, not left blank
    expect(items[1]!.textContent).toContain('202412345K')
    expect(items[2]!.textContent).toMatch(/No.*Yes/) // booleans read as words
  })

  it('says nothing is saved until Save, and applies or cancels only when asked', () => {
    const onApply = vi.fn()
    const onCancel = vi.fn()
    render(<PrefillConfirmSheet open changes={changes} onApply={onApply} onCancel={onCancel} />)
    expect(screen.getByText(/nothing is saved until you press save/i)).toBeTruthy()
    expect(onApply).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Apply to the form' }))
    expect(onApply).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('when nothing would change, says so and offers no apply', () => {
    render(<PrefillConfirmSheet open changes={[]} onApply={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText(/nothing to change/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Apply to the form' })).toBeNull()
  })

  it('renders nothing while closed', () => {
    render(<PrefillConfirmSheet open={false} changes={changes} onApply={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('BusinessProfileSection buttons (DECISIONS #108)', () => {
  it('Replace and Remove are BOTH outlined (white fill, a border), and Fill is the one filled button', () => {
    render(<BusinessProfileSection profile={make({ status: 'ready', document: profileDoc() })} onFill={vi.fn()} fillBusy={false} />)
    const replace = screen.getByRole('button', { name: 'Replace' })
    const remove = screen.getByRole('button', { name: 'Remove' })
    for (const button of [replace, remove]) {
      expect(button.className).toContain('bg-white')
      expect(button.className).toContain('border-line')
    }
    expect(remove.className).toBe(replace.className) // matching exactly, not just similar
    expect(remove.className).not.toContain('bg-transparent') // no longer the ghost look
    const filled = screen.getAllByRole('button').filter((b) => b.className.includes('bg-ink') && b.className.includes('text-white'))
    expect(filled).toHaveLength(1)
  })
})

