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
