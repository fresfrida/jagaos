import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../ops/opsApi', async (importActual) => ({
  ...(await importActual<typeof import('../ops/opsApi')>()),
  opsApi: { getLimits: vi.fn() },
}))

import { ApiError } from '../../lib/apiClient'
import { opsApi } from '../ops/opsApi'
import { assertWithinFileLimit, maxFileBytes, resetFileLimitCache } from './fileLimit'

const getLimits = vi.mocked(opsApi.getLimits)
const MB = 1024 * 1024
const file = (size: number) => Object.defineProperty(new File(['x'], 'f.bin'), 'size', { value: size }) as File

beforeEach(() => {
  vi.resetAllMocks()
  resetFileLimitCache()
  getLimits.mockResolvedValue({ max_file_bytes: 25 * MB, max_personal_files: 15, personal_files_used: 0 })
})

describe('the browser-side file limit', () => {
  it('lets a file at the limit through and refuses one byte over, with the server\'s own error shape', async () => {
    await expect(assertWithinFileLimit([file(25 * MB)])).resolves.toBeUndefined()
    const error = await assertWithinFileLimit([file(25 * MB + 1)]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 413, code: 'file_too_large' })
    expect((error as ApiError).data?.limit_bytes).toBe(25 * MB)
  })

  it('refuses a set if any one page is over', async () => {
    await expect(assertWithinFileLimit([file(1), file(30 * MB), file(2)])).rejects.toMatchObject({ code: 'file_too_large' })
  })

  it('asks the server for the number once and remembers it', async () => {
    await maxFileBytes()
    await maxFileBytes()
    await assertWithinFileLimit([file(1)])
    expect(getLimits).toHaveBeenCalledTimes(1)
  })

  it('with no known limit (an older backend, or a failed fetch) refuses nothing, and asks again next time', async () => {
    getLimits.mockRejectedValueOnce(new ApiError(404, 'Not Found'))
    await expect(assertWithinFileLimit([file(999 * MB)])).resolves.toBeUndefined()

    await expect(assertWithinFileLimit([file(999 * MB)])).rejects.toMatchObject({ code: 'file_too_large' }) // it asked again and now knows
    expect(getLimits).toHaveBeenCalledTimes(2)
  })

  it('an api object with no getLimits at all is a shrug, not a crash', async () => {
    getLimits.mockImplementation(() => { throw new TypeError('not a function') })
    await expect(assertWithinFileLimit([file(999 * MB)])).resolves.toBeUndefined()
  })
})
