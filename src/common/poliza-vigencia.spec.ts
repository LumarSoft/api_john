import { estadoPago, estadoVigencia, inForcePolizaWhere, isCancelledStatus } from './poliza-vigencia'

describe('poliza vigencia', () => {
  const now = new Date('2026-09-30T12:00:00Z')
  const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

  // Real case: a Corsa whose policy runs until 03/10 and its renewal from 03/10.
  const actual = { status: 'REFACTURACION', vigenciaDesde: d('2026-03-03'), vigenciaHasta: d('2026-10-03') }
  const renovacion = { status: 'RENOVACION', vigenciaDesde: d('2026-10-03'), vigenciaHasta: d('2027-10-03') }

  it('the policy covering today is vigente, its renewal is próxima', () => {
    expect(estadoVigencia(actual, now)).toBe('vigente')
    expect(estadoVigencia(renovacion, now)).toBe('proxima')
  })

  it('swaps on the renewal date', () => {
    const onRenewal = new Date('2026-10-03T10:00:00Z')
    expect(estadoVigencia(actual, onRenewal)).toBe('vencida')
    expect(estadoVigencia(renovacion, onRenewal)).toBe('vigente')
  })

  it('a cancelled policy is anulada even if its end date is in the future', () => {
    const anulada = { status: 'ANULA POR VENTA', vigenciaDesde: d('2026-02-27'), vigenciaHasta: d('2027-02-27') }
    expect(estadoVigencia(anulada, now)).toBe('anulada')
  })

  it.each([
    ['ANULA POR VENTA', true],
    ['ANUL.P/CAMBIO DE CIA', true],
    ['RESCISION UNILATERAL', true],
    ['ENDOSO ANULA ENDOSO', false],
    ['REFACTURACION', false],
    ['RENOVACION', false],
  ])('isCancelledStatus(%s) = %s', (status, expected) => {
    expect(isCancelledStatus(status)).toBe(expected)
  })

  it('builds a where-clause that requires started, not ended and not cancelled', () => {
    expect(inForcePolizaWhere(now)).toEqual({
      deletedAt: null,
      vigenciaHasta: { gte: now },
      OR: [{ vigenciaDesde: null }, { vigenciaDesde: { lte: now } }],
      NOT: [{ status: { startsWith: 'ANUL' } }, { status: { startsWith: 'RESCISION' } }],
    })
  })
})

describe('estadoPago', () => {
  // 5/10/2026 12:00 in Argentina. Due dates are stored as UTC midnight.
  const now = new Date('2026-10-05T15:00:00Z')
  const due = (iso: string) => new Date(`${iso}T00:00:00Z`)

  it('is al día when every installment is paid or not yet past due', () => {
    expect(
      estadoPago(
        [
          { status: 'paid', dueDate: due('2026-09-10') },
          { status: 'pending', dueDate: due('2026-11-10') },
        ],
        now,
      ),
    ).toEqual({ alDia: true, cuotasRechazadas: 0, cuotasVencidas: 0 })
  })

  it('does not treat an installment due today as past due, even if the sync marked it overdue', () => {
    expect(
      estadoPago(
        [
          { status: 'pending', dueDate: due('2026-10-05') },
          { status: 'overdue', dueDate: due('2026-10-05') },
        ],
        now,
      ).alDia,
    ).toBe(true)
    // Late at night in Argentina it is still the due date (already the 6th in UTC).
    expect(
      estadoPago([{ status: 'overdue', dueDate: due('2026-10-05') }], new Date('2026-10-06T02:30:00Z')).alDia,
    ).toBe(true)
  })

  it('flags a rejected debit', () => {
    expect(estadoPago([{ status: 'rejected', dueDate: due('2026-10-10') }], now)).toEqual({
      alDia: false,
      cuotasRechazadas: 1,
      cuotasVencidas: 0,
    })
  })

  it('counts installments past their due date, including pending ones the sync did not update', () => {
    expect(
      estadoPago(
        [
          { status: 'overdue', dueDate: due('2026-09-10') },
          { status: 'pending', dueDate: due('2026-10-04') },
          { status: 'overdue', dueDate: null },
        ],
        now,
      ),
    ).toEqual({ alDia: false, cuotasRechazadas: 0, cuotasVencidas: 3 })
  })
})
