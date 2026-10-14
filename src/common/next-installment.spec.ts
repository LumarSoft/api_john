import { estimateNextDueDate } from './next-installment'

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('estimateNextDueDate', () => {
  it('is a month after the latest due date for monthly installments', () => {
    const next = estimateNextDueDate([d('2026-07-27'), d('2026-08-27'), d('2026-09-27')], d('2027-07-27'))
    expect(next?.toISOString()).toBe('2026-10-27T00:00:00.000Z')
  })

  it('goes by date, not by installment number', () => {
    // Out of order, as batches numbered from 1 come back from the cartera.
    const next = estimateNextDueDate([d('2026-09-27'), d('2026-07-27'), d('2026-08-27')], null)
    expect(next?.toISOString()).toBe('2026-10-27T00:00:00.000Z')
  })

  it('keeps the policy cadence when it is not monthly', () => {
    const next = estimateNextDueDate([d('2026-02-10'), d('2026-06-10')], d('2027-02-10'))
    expect(next?.toISOString()).toBe('2026-10-10T00:00:00.000Z')
  })

  it('clamps to the end of a shorter month', () => {
    expect(estimateNextDueDate([d('2027-01-31')], null)?.toISOString()).toBe('2027-02-28T00:00:00.000Z')
  })

  it('has no next installment past the end of the policy or without due dates', () => {
    expect(estimateNextDueDate([d('2026-12-10')], d('2027-01-10'))).toBeNull()
    expect(estimateNextDueDate([null], null)).toBeNull()
  })
})
