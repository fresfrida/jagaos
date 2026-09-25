import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import i18n from '../../i18n'
import { ApiError } from '../../lib/apiClient'
import { uploadErrorMessage } from './uploadErrorMessage'

beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(async () => { await i18n.changeLanguage('en') })

const t = () => i18n.t.bind(i18n)

describe('uploadErrorMessage', () => {
  it('translates a too-large file by its code and names the limit from the error', () => {
    const error = new ApiError(413, 'English text', 'file_too_large', { limit_bytes: 25 * 1024 * 1024 })
    expect(uploadErrorMessage(t(), 'English text', error)).toBe('That file is larger than the 25 MB limit.')
  })

  it('translates the private-file limit by its code, with the number', () => {
    const error = new ApiError(409, 'English text', 'personal_file_limit', { limit: 15 })
    expect(uploadErrorMessage(t(), 'English text', error)).toBe('You have reached the limit of 15 private files. Delete one to add another.')
  })

  it('says it in the page\'s language, so a Malay page never shows an English sentence for these', async () => {
    await i18n.changeLanguage('ms')
    const error = new ApiError(413, 'English text', 'file_too_large', { limit_bytes: 25 * 1024 * 1024 })
    expect(uploadErrorMessage(t(), 'English text', error)).toBe('Fail itu melebihi had 25 MB.')
  })

  it('anything else keeps the message it came with', () => {
    expect(uploadErrorMessage(t(), 'Page 2 is not a readable image', new ApiError(400, 'x'))).toBe('Page 2 is not a readable image')
    expect(uploadErrorMessage(t(), 'plain', undefined)).toBe('plain')
    expect(uploadErrorMessage(t(), 'plain', new Error('x'))).toBe('plain')
  })

  it('falls back to the rule\'s own numbers when the error does not carry them', () => {
    expect(uploadErrorMessage(t(), 'x', new ApiError(413, 'x', 'file_too_large'))).toContain('25 MB')
    expect(uploadErrorMessage(t(), 'x', new ApiError(409, 'x', 'personal_file_limit'))).toContain('15')
  })
})
