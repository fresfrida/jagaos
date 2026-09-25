/** The upload area's Only me variant (round 21, A3, DECISIONS #101): the two rows say nothing is read or captioned, instead of
 * promising a caption and data extraction. */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import { UploadPanel } from './UploadPanel'
import type { UploadFlow } from './useUploadFlow'

const flow = (over: Partial<UploadFlow> = {}) =>
  ({
    busy: false, uploading: null, staged: null, selectionError: null, draft: null,
    uploadPhoto: vi.fn(), chooseDocumentFiles: vi.fn(), addPages: vi.fn(), move: vi.fn(), remove: vi.fn(), cancelStaging: vi.fn(),
    submitPages: vi.fn(), saveDraft: vi.fn(), cancelDraft: vi.fn(), ...over,
  }) as unknown as UploadFlow

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

describe('UploadPanel', () => {
  it('the company Upload page keeps its own descriptions of the two rows', () => {
    render(<UploadPanel flow={flow()} />)
    expect(screen.getByText('A place, thing, or people, caption only')).toBeTruthy()
  })

  it('Only me describes them as named by the person, with nothing read', () => {
    render(<UploadPanel flow={flow()} personal />)
    expect(screen.getByText('A PDF, or photos of its pages. You name it; nothing is read.')).toBeTruthy()
    expect(screen.getByText('A picture you want to keep. You name it and add your own caption.')).toBeTruthy()
    expect(screen.queryByText('A place, thing, or people, caption only')).toBeNull()
  })

  it('while a personal file is being sent it shows the saving line, not the reading story', () => {
    render(<UploadPanel flow={flow({ busy: true, uploading: { name: 'Passport' } })} personal />)
    expect(screen.getByTestId('upload-narration').textContent).toBe('Saving to Only me…')
  })
})
