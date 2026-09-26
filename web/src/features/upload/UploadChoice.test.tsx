/** The Document / Photo file inputs' contract (2026-09-26, DECISIONS #128).
 *
 * A mobile report said Photo opens the album or file picker without offering the camera. The source and the deployed
 * bundle were both already what this file pins, so this is regression coverage for the attribute contract, NOT a
 * check of what the phone's native chooser shows: jsdom has no chooser, and whether a camera option appears is
 * decided by the browser and OS from `accept` and `multiple`. Only a physical iPhone and Android phone can say
 * (docs/HANDOFF.md, "Photo picker on phones").
 *
 * What is pinned, and why each one matters:
 * - Photo is `accept="image/*"`, single, and has NO `capture`: `capture` opens the camera directly with no way to pick
 *   an existing photo, which the product does not want as the default.
 * - Document keeps `application/pdf,image/*` and `multiple` (several photos of one document's pages).
 * - One chosen photo reaches `onPhotoFile` exactly once.
 * The same component is used by the Upload page (through UploadPanel) and by the universal Upload sheet. */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ status: 'signed-in', role: 'user' }) }))
vi.mock('../../router/navigate', () => ({ navigate: vi.fn() }))

import { openUploadSheet } from '../../lib/uploadTrigger'
import { navigate } from '../../router/navigate'
import { takePendingSelection } from './pendingSelection'
import { UploadChoice } from './UploadChoice'
import { UploadPanel } from './UploadPanel'
import { UploadSheetHost } from './UploadSheetHost'
import type { UploadFlow } from './useUploadFlow'

const photo = new File(['jpeg-bytes'], 'receipt.jpg', { type: 'image/jpeg' })
const pdf = new File(['%PDF'], 'invoice.pdf', { type: 'application/pdf' })

const photoInput = () => screen.getByTestId('photo-input') as HTMLInputElement
const documentInput = () => screen.getByTestId('document-input') as HTMLInputElement
const choose = async (input: HTMLInputElement, ...files: File[]) => {
  await act(async () => { fireEvent.change(input, { target: { files } }) })
}

/** The attribute contract, asserted the same way wherever the inputs are rendered. */
function expectInputContract() {
  const photoEl = photoInput()
  expect(photoEl.type).toBe('file')
  expect(photoEl.getAttribute('accept')).toBe('image/*')
  expect(photoEl.hasAttribute('capture')).toBe(false)
  expect(photoEl.multiple).toBe(false)
  expect(photoEl.hasAttribute('multiple')).toBe(false)

  const documentEl = documentInput()
  expect(documentEl.type).toBe('file')
  expect(documentEl.getAttribute('accept')).toBe('application/pdf,image/*')
  expect(documentEl.hasAttribute('capture')).toBe(false)
  expect(documentEl.multiple).toBe(true)
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.mocked(navigate).mockClear()
  takePendingSelection() // nothing parked from an earlier test
})
afterEach(cleanup)

describe('UploadChoice, on its own', () => {
  it('keeps the Photo and Document input attributes', () => {
    render(<UploadChoice disabled={false} onDocumentFiles={vi.fn()} onPhotoFile={vi.fn()} />)
    expectInputContract()
  })

  it('reports one chosen photo exactly once, with that file', async () => {
    const onPhotoFile = vi.fn()
    const onDocumentFiles = vi.fn()
    render(<UploadChoice disabled={false} onDocumentFiles={onDocumentFiles} onPhotoFile={onPhotoFile} />)
    await choose(photoInput(), photo)
    expect(onPhotoFile).toHaveBeenCalledTimes(1)
    expect(onPhotoFile).toHaveBeenCalledWith(photo)
    expect(onDocumentFiles).not.toHaveBeenCalled()
  })

  it('reports every chosen document file together, once', async () => {
    const onDocumentFiles = vi.fn()
    const onPhotoFile = vi.fn()
    render(<UploadChoice disabled={false} onDocumentFiles={onDocumentFiles} onPhotoFile={onPhotoFile} />)
    await choose(documentInput(), pdf, photo)
    expect(onDocumentFiles).toHaveBeenCalledTimes(1)
    expect(onDocumentFiles).toHaveBeenCalledWith([pdf, photo])
    expect(onPhotoFile).not.toHaveBeenCalled()
  })

  it('each row opens its own input (Photo does not open the Document input, or the reverse)', () => {
    render(<UploadChoice disabled={false} onDocumentFiles={vi.fn()} onPhotoFile={vi.fn()} />)
    const clicks: string[] = []
    photoInput().addEventListener('click', () => clicks.push('photo'))
    documentInput().addEventListener('click', () => clicks.push('document'))
    fireEvent.click(screen.getByRole('button', { name: /Photo/ }))
    fireEvent.click(screen.getByRole('button', { name: /Document/ }))
    expect(clicks).toEqual(['photo', 'document'])
  })
})

describe('the Upload page (UploadPanel)', () => {
  const flow = () =>
    ({ busy: false, uploading: null, uploadPhoto: vi.fn(), chooseDocumentFiles: vi.fn() }) as unknown as UploadFlow

  it('renders the same inputs and wires a chosen photo to uploadPhoto once', async () => {
    const f = flow()
    render(<UploadPanel flow={f} />)
    expectInputContract()
    await choose(photoInput(), photo)
    expect(f.uploadPhoto).toHaveBeenCalledTimes(1)
    expect(f.uploadPhoto).toHaveBeenCalledWith(photo)
    expect(f.chooseDocumentFiles).not.toHaveBeenCalled()
  })

  it('renders the same inputs for Only me (personal)', () => {
    render(<UploadPanel flow={flow()} personal />)
    expectInputContract()
  })
})

describe('the universal Upload sheet (UploadSheetHost)', () => {
  const openSheet = async () => { await act(async () => { openUploadSheet() }) }

  it('renders the same inputs inside the dialog, still mounted while it is open', async () => {
    render(<UploadSheetHost />)
    expect(screen.queryByTestId('photo-input')).toBeNull() // closed: nothing mounted yet
    await openSheet()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expectInputContract()
    // Opening the picker must not close the sheet: it closes only once something was chosen, else the input would
    // be unmounted before its change event.
    fireEvent.click(screen.getByRole('button', { name: /Photo/ }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByTestId('photo-input')).toBeTruthy()
  })

  it('hands one chosen photo off exactly once and goes to the Upload page', async () => {
    render(<UploadSheetHost />)
    await openSheet()
    await choose(photoInput(), photo)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(takePendingSelection()).toEqual({ kind: 'photo', file: photo })
    expect(takePendingSelection()).toBeNull() // one reader, once
  })
})
