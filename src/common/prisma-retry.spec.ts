import { isWriteConflict, retryOnWriteConflict } from './prisma-retry'

const deadlock = () =>
  Object.assign(new Error('Transaction failed due to a write conflict or a deadlock'), { code: 'P2034' })

describe('retryOnWriteConflict', () => {
  it('runs the work again after a deadlock and returns its result', async () => {
    const work = jest.fn().mockRejectedValueOnce(deadlock()).mockResolvedValueOnce('ok')
    const onRetry = jest.fn()

    await expect(retryOnWriteConflict(work, { delayMs: 1, onRetry })).resolves.toBe('ok')

    expect(work).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledWith(1)
  })

  it('gives up after the last attempt and rethrows the deadlock', async () => {
    const work = jest.fn().mockRejectedValue(deadlock())

    await expect(retryOnWriteConflict(work, { attempts: 3, delayMs: 1 })).rejects.toMatchObject({ code: 'P2034' })

    expect(work).toHaveBeenCalledTimes(3)
  })

  it('does not retry any other error', async () => {
    const work = jest.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }))

    await expect(retryOnWriteConflict(work, { delayMs: 1 })).rejects.toMatchObject({ code: 'P2002' })

    expect(work).toHaveBeenCalledTimes(1)
  })

  it('recognizes only the write-conflict code', () => {
    expect(isWriteConflict(deadlock())).toBe(true)
    expect(isWriteConflict({ code: 'P2002' })).toBe(false)
    expect(isWriteConflict(new Error('x'))).toBe(false)
    expect(isWriteConflict(null)).toBe(false)
  })
})
