/**
 * Prisma's code for a transaction MySQL rolled back to break a deadlock or a
 * lock wait (`1213 Deadlock found when trying to get lock; try restarting
 * transaction`). The loser only has to run again once the other one is done.
 */
const WRITE_CONFLICT = 'P2034'

export function isWriteConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === WRITE_CONFLICT
}

/**
 * Runs `work` again when MySQL rolled it back as the loser of a deadlock, up
 * to `attempts` times in all, with a short pause so the winner finishes
 * first. `work` must be safe to repeat from scratch: a rolled-back
 * transaction left nothing behind, and anything it inserts has to be
 * idempotent anyway (Meta retries its webhooks). Any other error is rethrown
 * at once. On 2/11 three echoes of files the office sent in one second raced
 * on the same conversation row and the one in the middle was lost.
 */
export async function retryOnWriteConflict<T>(
  work: () => Promise<T>,
  options: { attempts?: number; delayMs?: number; onRetry?: (attempt: number) => void } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3)
  const delayMs = options.delayMs ?? 50
  for (let attempt = 1; ; attempt++) {
    try {
      return await work()
    } catch (error) {
      if (!isWriteConflict(error) || attempt >= attempts) throw error
      options.onRetry?.(attempt)
      // A little jitter so two losers don't collide again on the same tick.
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt + Math.floor(Math.random() * delayMs)))
    }
  }
}
