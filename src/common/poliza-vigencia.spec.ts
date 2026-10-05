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
  const now = new Date(2026, 9, 5, 12)

  it('is al día when every installment is paid or not yet due', () => {
    expect(
      estadoPago(
        [
          { status: 'paid', dueDate: new Date(2026, 8, 10) },
          { status: 'pending', dueDate: new Date(2026, 9, 5) },
          { status: 'pending', dueDate: new Date(2026, 10, 10) },
        ],
        now,
      ),
    ).toEqual({ alDia: true, cuotasRechazadas: 0, cuotasVencidas: 0 })
  })

  it('flags a rejected debit', () => {
    expect(estadoPago([{ status: 'rejected', dueDate: new Date(2026, 9, 10) }], now)).toEqual({
      alDia: false,
      cuotasRechazadas: 1,
      cuotasVencidas: 0,
    })
  })

  it('counts overdue installments, including pending ones whose due date already passed', () => {
    expect(
      estadoPago(
        [
          { status: 'overdue', dueDate: new Date(2026, 8, 10) },
          { status: 'pending', dueDate: new Date(2026, 9, 4) },
        ],
        now,
      ),
    ).toEqual({ alDia: false, cuotasRechazadas: 0, cuotasVencidas: 2 })
  })
})
