import { CoverageSettingsService } from './coverage-settings.service'
import type { PrismaService } from '../prisma/prisma.service'
import { VehicleType } from '../infoauto/infoauto.types'

describe('motorcycle wording', () => {
  it('names moto coverages as Triunfo does and ignores the car settings of the same codes', async () => {
    const prisma = {
      coverageSetting: {
        findMany: jest.fn().mockResolvedValue([
          {
            code: 'B1',
            name: 'Todo Total 1',
            tagline: 'auto',
            benefits: ['x'],
            isActive: true,
            highlighted: true,
            sortOrder: 1,
          },
        ]),
      },
    }
    const service = new CoverageSettingsService(prisma as unknown as PrismaService)
    const quoted = [{ code: 'B1' }, { code: 'B4' }, { code: 'A' }]

    const result = await service.apply(1, quoted, 2026, ['A', 'B4', 'B1'], VehicleType.MOTO)

    expect(result.map(c => [c.code, c.name, c.highlighted])).toEqual([
      ['A', 'Responsabilidad civil', false],
      ['B4', 'Responsabilidad civil + incendio', false],
      ['B1', 'RC + incendio + robo', false],
    ])
    expect(result[2].benefits).toContain('Robo y/o hurto total')
  })
})

describe('motorcycle required coverages', () => {
  it('keeps A, B and B1 even when car display settings hide them by activity or year', async () => {
    const prisma = {
      coverageSetting: {
        findMany: jest.fn().mockResolvedValue([
          // Hiding by activity or year is an admin edit, so these rows are configured.
          {
            code: 'A',
            isActive: false,
            isConfigured: true,
            yearFrom: null,
            yearTo: null,
            sortOrder: 1,
            benefits: ['x'],
          },
          {
            code: 'B',
            isActive: true,
            isConfigured: true,
            yearFrom: 2025,
            yearTo: null,
            sortOrder: 2,
            benefits: ['x'],
          },
          {
            code: 'B1',
            isActive: true,
            isConfigured: true,
            yearFrom: null,
            yearTo: 2020,
            sortOrder: 3,
            benefits: ['x'],
          },
        ]),
      },
    }
    const service = new CoverageSettingsService(prisma as unknown as PrismaService)
    const coverages = [{ code: 'A' }, { code: 'B' }, { code: 'B1' }]
    expect((await service.apply(1, coverages, 2024, ['A', 'B', 'B1'])).map(c => c.code)).toEqual(['A', 'B', 'B1'])
    expect(await service.apply(1, coverages, 2024)).toEqual([])
  })
})

describe('recommended coverage by vehicle year', () => {
  const row = (code: string, sortOrder: number, extra: Record<string, unknown> = {}) => ({
    code,
    name: code,
    tagline: null,
    benefits: ['Daños a terceros'],
    isActive: true,
    highlighted: false,
    sortOrder,
    yearFrom: null,
    yearTo: null,
    highlightYearFrom: null,
    highlightYearTo: null,
    // Highlighting a coverage is an admin edit, so these rows are configured.
    isConfigured: true,
    ...extra,
  })

  function serviceWith(rows: unknown[]) {
    const prisma = { coverageSetting: { findMany: jest.fn().mockResolvedValue(rows) } }
    return new CoverageSettingsService(prisma as unknown as PrismaService)
  }

  const quoted = [{ code: 'A' }, { code: 'B1' }, { code: 'C1' }, { code: 'D2' }]
  // C1 recommended from 2010 on, B1 for older cars.
  const rows = [
    row('A', 100),
    row('B1', 201, { highlighted: true, highlightYearTo: 2009 }),
    row('C1', 301, { highlighted: true, highlightYearFrom: 2010 }),
    row('D2', 402),
  ]

  it('puts the coverage recommended for a 2015 car first and flags only that one', async () => {
    const result = await serviceWith(rows).apply(1, quoted, 2015)

    expect(result.map(c => c.code)).toEqual(['C1', 'A', 'B1', 'D2'])
    expect(result.filter(c => c.highlighted).map(c => c.code)).toEqual(['C1'])
  })

  it('recommends a different coverage for an older car', async () => {
    const result = await serviceWith(rows).apply(1, quoted, 2005)

    expect(result.map(c => c.code)).toEqual(['B1', 'A', 'C1', 'D2'])
    expect(result.filter(c => c.highlighted).map(c => c.code)).toEqual(['B1'])
  })

  it('keeps a highlighted coverage without a range recommended for every year', async () => {
    const result = await serviceWith([row('A', 100), row('D2', 402, { highlighted: true })]).apply(
      1,
      [{ code: 'A' }, { code: 'D2' }],
      1998,
    )

    expect(result.map(c => [c.code, c.highlighted])).toEqual([
      ['D2', true],
      ['A', false],
    ])
  })

  it('keeps the configured order when nothing is recommended for the year', async () => {
    const result = await serviceWith(rows).apply(1, [{ code: 'D2' }, { code: 'A' }], 2015)

    expect(result.map(c => c.code)).toEqual(['A', 'D2'])
  })
})

describe('car coverage wording', () => {
  // Rows as they sit in production: discovered with the old letter-based copy,
  // which promised destrucción total on every B, and never edited.
  const discovered = (code: string, sortOrder: number, extra: Record<string, unknown> = {}) => ({
    code,
    name: `Todo Total ${code.slice(1)}`.trim(),
    tagline: 'Responsabilidad civil + pérdidas totales',
    benefits: ['Robo y hurto total', 'Incendio total', 'Destrucción total por accidente'],
    exclusions: null,
    isActive: true,
    isConfigured: false,
    highlighted: false,
    sortOrder,
    yearFrom: null,
    yearTo: null,
    highlightYearFrom: null,
    highlightYearTo: null,
    ...extra,
  })

  function serviceWith(rows: unknown[]) {
    const prisma = { coverageSetting: { findMany: jest.fn().mockResolvedValue(rows) } }
    return new CoverageSettingsService(prisma as unknown as PrismaService)
  }

  it('tells B and B1 apart instead of promising destrucción total on both', async () => {
    const service = serviceWith([discovered('B', 200), discovered('B1', 201)])

    const [b, b1] = await service.apply(1, [{ code: 'B' }, { code: 'B1' }], 2009)

    expect(b.benefits).toContain('Destrucción total por accidente')
    expect(b1.benefits).not.toContain('Destrucción total por accidente')
    expect(b1.exclusions).toContain('Destrucción total por accidente')
    expect(b1.name).not.toEqual(b.name)
  })

  it('offers the everyday codes by default and keeps the rest described but off', async () => {
    const service = serviceWith([
      discovered('A', 100, { isConfigured: true, name: 'Responsabilidad Civil', benefits: ['RC'] }),
      discovered('B4', 204),
      discovered('C', 300),
      discovered('C2', 302),
      discovered('D3', 403),
    ])
    // C7 is not in Triunfo's manual; B4, C and D4 are, but are off by default.
    const quoted = ['A', 'B4', 'C', 'C2', 'C7', 'D3', 'D4'].map(code => ({ code }))

    const result = await service.apply(1, quoted, 2025)

    expect(result.map(c => c.code)).toEqual(['A', 'C2', 'D3'])
    expect(result.find(c => c.code === 'C2')?.benefits.join(' ')).toMatch(/Parabrisas y luneta hasta \$500\.000/)
    expect(result.find(c => c.code === 'D3')?.exclusions.join(' ')).toMatch(/10% del siniestro, mínimo \$550\.000/)
  })

  it('offers a code an admin described, with the admin wording', async () => {
    const service = serviceWith([
      discovered('B4', 204, {
        isConfigured: true,
        name: 'RC + incendio total',
        benefits: ['Incendio total'],
        exclusions: ['Robo'],
      }),
    ])

    const [b4] = await service.apply(1, [{ code: 'B4' }], 2020)

    expect(b4).toMatchObject({ name: 'RC + incendio total', benefits: ['Incendio total'], exclusions: ['Robo'] })
  })

  it('hides a code made visible without saying what it includes', async () => {
    const service = serviceWith([discovered('B4', 204, { isConfigured: true, benefits: [] })])

    expect(await service.apply(1, [{ code: 'B4' }], 2020)).toEqual([])
  })

  it('offers a described code once an admin switches it on, with the manual wording', async () => {
    const service = serviceWith([
      discovered('B3', 203, { isConfigured: true, isActive: true, benefits: ['Incendio total y parcial'] }),
    ])

    const [b3] = await service.apply(1, [{ code: 'B3' }], 2020)

    expect(b3.code).toBe('B3')
  })

  it('describes each code as the manual does: C1 has no destrucción total, B4 no robo', async () => {
    const service = serviceWith([discovered('C1', 301), discovered('B4', 204)])

    const [c1, b4] = await service.listForAdmin(1)

    expect(c1.benefits).not.toContain('Destrucción total por accidente')
    expect(c1.exclusions).toContain('Destrucción total por accidente')
    expect(b4.benefits).toEqual(['Todo lo de Responsabilidad Civil', 'Incendio total'])
    expect(b4.exclusions).toContain('Robo o hurto')
  })

  it('keeps the confirmed exclusions for a row configured before exclusions existed', async () => {
    const service = serviceWith([
      discovered('B1', 201, { isConfigured: true, name: 'B1 de la oficina', exclusions: null }),
    ])

    const [b1] = await service.apply(1, [{ code: 'B1' }], 2020)

    expect(b1.name).toBe('B1 de la oficina')
    expect(b1.exclusions).toContain('Destrucción total por accidente')
  })
})

describe('editing a coverage for the first time', () => {
  it('saves the wording the admin was shown, not the stale discovered copy', async () => {
    const update = jest.fn().mockImplementation(async ({ data }) => ({
      id: 7,
      code: 'B1',
      isConfigured: true,
      firstSeenAt: new Date(),
      ...data,
    }))
    const prisma = {
      coverageSetting: {
        findFirst: jest.fn().mockResolvedValue({ id: 7, code: 'B1', isConfigured: false }),
        update,
      },
    }
    const service = new CoverageSettingsService(prisma as unknown as PrismaService)

    await service.update(1, 7, { isActive: false })

    const data = update.mock.calls[0][0].data
    expect(data.isActive).toBe(false)
    expect(data.isConfigured).toBe(true)
    expect(data.benefits).not.toContain('Destrucción total por accidente')
    expect(data.exclusions).toContain('Destrucción total por accidente')
  })

  it('switches on a code that was off by default without losing its wording', async () => {
    const update = jest.fn().mockImplementation(async ({ data }) => ({ id: 7, code: 'B3', ...data }))
    const prisma = {
      coverageSetting: {
        findFirst: jest.fn().mockResolvedValue({ id: 7, code: 'B3', isConfigured: false }),
        update,
      },
    }
    const service = new CoverageSettingsService(prisma as unknown as PrismaService)

    await service.update(1, 7, { isActive: true })

    const data = update.mock.calls[0][0].data
    expect(data.isActive).toBe(true)
    expect(data.benefits).toContain('Incendio total y parcial')
  })

  it('lets the edit override the default wording', async () => {
    const update = jest.fn().mockImplementation(async ({ data }) => ({ id: 7, code: 'B4', ...data }))
    const prisma = {
      coverageSetting: {
        findFirst: jest.fn().mockResolvedValue({ id: 7, code: 'B4', isConfigured: false }),
        update,
      },
    }
    const service = new CoverageSettingsService(prisma as unknown as PrismaService)

    await service.update(1, 7, { name: 'RC + incendio', benefits: ['Incendio total'] })

    expect(update.mock.calls[0][0].data).toMatchObject({ name: 'RC + incendio', benefits: ['Incendio total'] })
  })

  it('leaves the wording of an already configured coverage alone', async () => {
    const update = jest.fn().mockImplementation(async ({ data }) => ({ id: 7, code: 'B1', ...data }))
    const prisma = {
      coverageSetting: {
        findFirst: jest.fn().mockResolvedValue({ id: 7, code: 'B1', isConfigured: true }),
        update,
      },
    }
    const service = new CoverageSettingsService(prisma as unknown as PrismaService)

    await service.update(1, 7, { isActive: true })

    expect(update.mock.calls[0][0].data).not.toHaveProperty('benefits')
  })
})

describe('admin review flag', () => {
  const setting = (code: string, extra: Record<string, unknown> = {}) => ({
    id: 1,
    code,
    name: code,
    tagline: null,
    benefits: [],
    exclusions: null,
    isActive: true,
    isConfigured: false,
    highlighted: false,
    sortOrder: 0,
    yearFrom: null,
    yearTo: null,
    highlightYearFrom: null,
    highlightYearTo: null,
    firstSeenAt: new Date(),
    ...extra,
  })

  it('flags the codes that quotes hide because nothing says what they include', async () => {
    const prisma = {
      coverageSetting: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            setting('B1'),
            setting('B4'),
            setting('C1', { isConfigured: true }),
            setting('C7'),
            setting('C8', { isConfigured: true, benefits: ['Granizo ilimitado'] }),
          ]),
      },
    }
    const service = new CoverageSettingsService(prisma as unknown as PrismaService)

    const list = await service.listForAdmin(1)

    expect(list.map(c => [c.code, c.needsReview])).toEqual([
      ['B1', false],
      ['B4', false], // described by the manual
      ['C1', true], // an admin emptied it
      ['C7', true], // not in the manual
      ['C8', false],
    ])
    // Unconfigured rows show their default visibility, whatever was stored.
    expect(list.map(c => [c.code, c.isActive])).toEqual([
      ['B1', true],
      ['B4', false],
      ['C1', true],
      ['C7', false],
      ['C8', true],
    ])
  })
})
