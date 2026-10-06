import { CoverageSettingsService } from './coverage-settings.service'
import type { PrismaService } from '../prisma/prisma.service'

describe('motorcycle required coverages', () => {
  it('keeps A, B and B1 even when car display settings hide them by activity or year', async () => {
    const prisma = {
      coverageSetting: {
        findMany: jest.fn().mockResolvedValue([
          { code: 'A', isActive: false, yearFrom: null, yearTo: null, sortOrder: 1, benefits: [] },
          { code: 'B', isActive: true, yearFrom: 2025, yearTo: null, sortOrder: 2, benefits: [] },
          { code: 'B1', isActive: true, yearFrom: null, yearTo: 2020, sortOrder: 3, benefits: [] },
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
    benefits: [],
    isActive: true,
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
