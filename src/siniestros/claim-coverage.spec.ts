import {
  cancellationOf,
  checkClaimCoverage,
  coverageAlert,
  coveredOn,
  lapsedPolicyLine,
  policyTerm,
  type CoverageInstallment,
  type CoveragePolicy,
} from './claim-coverage'

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

/** A car policy from 03/03/2026 to 03/03/2027, as its first movement stored it. */
const policy = (over: Partial<CoveragePolicy> = {}): CoveragePolicy => ({
  certificateNumber: '4400001',
  endorsementNumber: 0,
  lastMovement: 'POLIZA NUEVA',
  validFrom: d('2026-03-03'),
  validTo: d('2027-03-03'),
  rawData: { Vigencia: 12, VigenciaDesde: '2026-03-03', VigenciaHasta: '2027-03-03' },
  ...over,
})

const cuota = (number: number, due: string, over: Partial<CoverageInstallment> = {}): CoverageInstallment => ({
  number,
  dueDate: d(due),
  status: 'overdue',
  providerStatus: 'PENDIENTE',
  ...over,
})

describe('policyTerm', () => {
  it('is the stored dates for a policy stored from its first movement', () => {
    expect(policyTerm(policy())).toEqual({ start: '2026-03-03', end: '2027-03-03' })
  })

  it('goes back to the real start when the sync first saw a later billing period', () => {
    // Loaded mid-term: validFrom is the quarter that was being billed, not the start.
    const loadedMidTerm = policy({
      endorsementNumber: 3,
      lastMovement: 'REFACTURACION',
      validFrom: d('2026-09-03'),
      rawData: { Vigencia: 12, VigenciaDesde: '2026-12-03' },
    })
    expect(policyTerm(loadedMidTerm).start).toBe('2026-03-03')
  })

  it('keeps the stored start of a first movement even when the term is shorter than Vigencia says', () => {
    const shortFirstTerm = policy({ validFrom: d('2026-05-20'), rawData: { Vigencia: 12 } })
    expect(policyTerm(shortFirstTerm).start).toBe('2026-05-20')
  })

  it('has no end for an open-ended policy (Vigencia 99, no end date)', () => {
    const openEnded = policy({ endorsementNumber: 4, validTo: null, rawData: { Vigencia: 99 } })
    expect(policyTerm(openEnded)).toEqual({ start: '2026-03-03', end: null })
  })

  it('clamps the day when the start month is shorter', () => {
    const endsOnThe31st = policy({
      endorsementNumber: 2,
      validFrom: d('2026-05-31'),
      validTo: d('2026-08-31'),
      rawData: { Vigencia: 6 },
    })
    expect(policyTerm(endsOnThe31st).start).toBe('2026-02-28')
  })
})

describe('cancellationOf', () => {
  it('reads the reason and the day the cancellation takes effect', () => {
    const cancelled = policy({ lastMovement: 'ANULA COBRANZA', rawData: { VigenciaDesde: '2026-06-03' } })
    expect(cancellationOf(cancelled)).toEqual({
      movement: 'ANULA COBRANZA',
      reason: 'por falta de pago',
      since: '2026-06-03',
    })
  })

  it('has no day when Triunfo sends none, and no reason for a movement it does not know', () => {
    const cancelled = policy({ lastMovement: 'ANULA P/ MOTIVOS VS.', rawData: { VigenciaDesde: '0000-00-00' } })
    expect(cancellationOf(cancelled)).toEqual({ movement: 'ANULA P/ MOTIVOS VS.', reason: null, since: null })
  })

  it('is null for a policy that is not cancelled, also one whose endorsement was cancelled', () => {
    expect(cancellationOf(policy())).toBeNull()
    expect(cancellationOf(policy({ lastMovement: 'ENDOSO ANULA ENDOSO' }))).toBeNull()
  })
})

describe('checkClaimCoverage', () => {
  it('finds nothing on a policy in its term with nothing unpaid', () => {
    const check = checkClaimCoverage({
      occurredAt: d('2026-10-12'),
      policy: policy(),
      installments: [cuota(9, '2026-11-03', { status: 'pending' })],
    })
    expect(check).toEqual({ level: 'ok', issues: [] })
  })

  it('counts the first and the last day of the term as covered', () => {
    expect(checkClaimCoverage({ occurredAt: d('2026-03-03'), policy: policy() }).level).toBe('ok')
    expect(checkClaimCoverage({ occurredAt: d('2027-03-03'), policy: policy() }).level).toBe('ok')
  })

  describe('cancelled policies', () => {
    const unpaid = policy({
      endorsementNumber: 4,
      lastMovement: 'ANULA COBRANZA',
      rawData: { Vigencia: 12, VigenciaDesde: '2026-06-03' },
    })

    it('is red, with the reason, when the cancellation was in effect on the day', () => {
      const check = checkClaimCoverage({ occurredAt: d('2026-10-12'), policy: unpaid })
      expect(check.level).toBe('danger')
      expect(check.issues).toHaveLength(1)
      expect(check.issues[0]).toMatchObject({
        code: 'CANCELLED',
        level: 'danger',
        title: 'Póliza anulada por falta de pago',
        date: '2026-06-03',
      })
      expect(check.issues[0].detail).toBe(
        'Triunfo la anuló (ANULA COBRANZA) con efecto desde el 03/06/2026. El hecho fue el 12/10/2026: ese día ya no tenía cobertura.',
      )
    })

    it('says nothing else about a policy cancelled by then: no dates, no installments', () => {
      const check = checkClaimCoverage({
        occurredAt: d('2027-06-01'),
        policy: unpaid,
        installments: [cuota(4, '2026-06-03')],
      })
      expect(check.issues.map(i => i.code)).toEqual(['CANCELLED'])
    })

    it('is a warning when the incident is from before the cancellation', () => {
      const check = checkClaimCoverage({
        occurredAt: d('2026-05-20'),
        policy: unpaid,
        installments: [cuota(3, '2026-05-03')],
      })
      expect(check.level).toBe('warning')
      expect(check.issues.map(i => i.code)).toEqual(['CANCELLED_AFTER'])
      expect(check.issues[0].title).toBe('Póliza anulada por falta de pago después del hecho')
    })

    it('is red when Triunfo gives no day for the cancellation', () => {
      const check = checkClaimCoverage({
        occurredAt: d('2026-05-20'),
        policy: policy({ lastMovement: 'ANULA POR VENTA', rawData: {} }),
      })
      expect(check.issues[0]).toMatchObject({
        code: 'CANCELLED',
        title: 'Póliza anulada por venta del bien',
        date: null,
      })
      expect(check.issues[0].detail).toContain('no informa desde qué día rige')
    })
  })

  describe('the day against the term', () => {
    it('is red when the incident is from before the policy started', () => {
      const check = checkClaimCoverage({ occurredAt: d('2026-02-27'), policy: policy() })
      expect(check.level).toBe('danger')
      expect(check.issues[0]).toMatchObject({
        code: 'BEFORE_START',
        title: 'El hecho es anterior al inicio de la póliza',
        date: '2026-03-03',
      })
      expect(check.issues[0].detail).toBe(
        'La póliza rige desde el 03/03/2026 y el hecho fue el 27/02/2026: ese día el bien no estaba cubierto por esta póliza.',
      )
    })

    it('is red when the incident is from after the policy ended', () => {
      const check = checkClaimCoverage({ occurredAt: d('2027-03-04'), policy: policy() })
      expect(check.issues[0]).toMatchObject({
        code: 'AFTER_END',
        level: 'danger',
        title: 'El hecho es posterior al vencimiento de la póliza',
        date: '2027-03-03',
      })
    })

    it('points to the policy this one renewed when that one covered the day', () => {
      const previous = policy({
        certificateNumber: '4300009',
        endorsementNumber: 4,
        lastMovement: 'REFACTURACION',
        validFrom: d('2025-12-03'),
        validTo: d('2026-03-03'),
        rawData: { Vigencia: 12 },
      })
      const check = checkClaimCoverage({
        occurredAt: d('2026-02-27'),
        policy: policy({ lastMovement: 'RENOVACION' }),
        otherPolicies: [previous],
      })
      expect(check.level).toBe('warning')
      expect(check.issues[0]).toMatchObject({ code: 'OTHER_POLICY', title: 'El hecho corresponde a otra póliza' })
      expect(check.issues[0].detail).toContain('la póliza N° 4300009')
    })

    it('stays red when the other policy was already cancelled on the day', () => {
      const previous = policy({
        certificateNumber: '4300009',
        endorsementNumber: 4,
        lastMovement: 'ANULA COBRANZA',
        validFrom: d('2025-03-03'),
        validTo: d('2026-03-03'),
        rawData: { Vigencia: 12, VigenciaDesde: '2025-12-03' },
      })
      const check = checkClaimCoverage({ occurredAt: d('2026-02-27'), policy: policy(), otherPolicies: [previous] })
      expect(check.issues[0].code).toBe('BEFORE_START')
    })

    it('does not look at installments outside the term', () => {
      const check = checkClaimCoverage({
        occurredAt: d('2027-04-01'),
        policy: policy(),
        installments: [cuota(12, '2027-02-03')],
      })
      expect(check.issues.map(i => i.code)).toEqual(['AFTER_END'])
    })
  })

  describe('unpaid installments', () => {
    it('warns about one that was due before the day of the incident', () => {
      const check = checkClaimCoverage({
        occurredAt: d('2026-10-12'),
        policy: policy(),
        installments: [cuota(7, '2026-09-03'), cuota(9, '2026-11-03', { status: 'pending' })],
      })
      expect(check.level).toBe('warning')
      expect(check.issues).toHaveLength(1)
      expect(check.issues[0]).toMatchObject({
        code: 'UNPAID_INSTALLMENTS',
        level: 'warning',
        title: '1 cuota impaga a la fecha del hecho',
        date: '2026-09-03',
      })
      expect(check.issues[0].detail).toBe(
        'La cuota 7 venció el 03/09/2026 y figura sin pagar en la última sincronización con Triunfo. Con cuotas vencidas la cobertura puede estar suspendida: confirmalo en Triunfo antes de gestionar el siniestro.',
      )
    })

    it('lists several, oldest first, whatever status the sync stamped', () => {
      const check = checkClaimCoverage({
        occurredAt: d('2026-10-12'),
        policy: policy(),
        installments: [cuota(8, '2026-10-03', { status: 'pending' }), cuota(6, '2026-08-03'), cuota(7, '2026-09-03')],
      })
      expect(check.issues[0].title).toBe('3 cuotas impagas a la fecha del hecho')
      expect(check.issues[0].detail).toContain(
        'Las cuotas 6, 7 y 8 (la más vieja venció el 03/08/2026) figuran sin pagar',
      )
    })

    it('leaves out one due on the day itself or later', () => {
      const check = checkClaimCoverage({
        occurredAt: d('2026-10-03'),
        policy: policy(),
        installments: [cuota(8, '2026-10-03'), cuota(9, '2026-11-03')],
      })
      expect(check.level).toBe('ok')
    })

    it('leaves out a debit already sent to the bank and a paid installment', () => {
      const check = checkClaimCoverage({
        occurredAt: d('2026-10-12'),
        policy: policy(),
        installments: [
          cuota(7, '2026-09-03', { status: 'pending', providerStatus: 'EN PRELIQUIDACIÓN' }),
          cuota(6, '2026-08-03', { status: 'paid', providerStatus: 'PAGADA' }),
        ],
      })
      expect(check.level).toBe('ok')
    })

    it('adds the rejected debit Triunfo reported for one of them', () => {
      const check = checkClaimCoverage({
        occurredAt: d('2026-10-12'),
        policy: policy(),
        installments: [cuota(7, '2026-09-03')],
        rejections: [
          { installmentNumber: 5, reason: 'TARJETA VENCIDA' },
          { installmentNumber: 7, reason: 'FONDOS INSUFICIENTES ' },
        ],
      })
      expect(check.issues[0].detail).toContain(
        'Triunfo informó el débito rechazado de la cuota 7 (FONDOS INSUFICIENTES).',
      )
    })
  })
})

describe('coveredOn', () => {
  it('is false outside the term and from the day a cancellation takes effect', () => {
    const cancelled = policy({ lastMovement: 'ANULA COBRANZA', rawData: { VigenciaDesde: '2026-06-03' } })
    expect(coveredOn(policy(), '2026-06-10')).toBe(true)
    expect(coveredOn(policy(), '2027-06-10')).toBe(false)
    expect(coveredOn(cancelled, '2026-06-02')).toBe(true)
    expect(coveredOn(cancelled, '2026-06-03')).toBe(false)
  })
})

describe('coverageAlert', () => {
  it('is the red issue in one line', () => {
    const check = checkClaimCoverage({ occurredAt: d('2026-02-27'), policy: policy() })
    expect(coverageAlert(check)).toBe(
      'El hecho es anterior al inicio de la póliza. La póliza rige desde el 03/03/2026 y el hecho fue el 27/02/2026: ese día el bien no estaba cubierto por esta póliza.',
    )
  })

  it('is null for a warning: an unpaid installment may be paid by the next sync', () => {
    const check = checkClaimCoverage({
      occurredAt: d('2026-10-12'),
      policy: policy(),
      installments: [cuota(7, '2026-09-03')],
    })
    expect(coverageAlert(check)).toBeNull()
    expect(coverageAlert({ level: 'ok', issues: [] })).toBeNull()
  })
})

describe('lapsedPolicyLine', () => {
  const now = d('2026-11-10')

  it('says why and since when a policy is cancelled', () => {
    const cancelled = policy({ lastMovement: 'ANULA COBRANZA', rawData: { VigenciaDesde: '2026-06-03' } })
    expect(lapsedPolicyLine({ ...cancelled, vehicle: { licensePlate: 'AB123CD' } }, now)).toBe(
      'N° 4400001 (AB123CD): anulada por falta de pago (ANULA COBRANZA) desde el 03/06/2026',
    )
  })

  it('says when a policy ended or will start', () => {
    expect(lapsedPolicyLine(policy({ validTo: d('2026-10-03') }), now)).toBe('N° 4400001: vencida el 03/10/2026')
    expect(lapsedPolicyLine(policy({ validFrom: d('2026-12-01') }), now)).toBe(
      'N° 4400001: empieza a regir el 01/12/2026',
    )
  })

  it('is null for a policy in force', () => {
    expect(lapsedPolicyLine(policy(), now)).toBeNull()
  })
})
