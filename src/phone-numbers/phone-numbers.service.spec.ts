import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma, Role } from 'generated/prisma/client'
import type { PrismaService } from '../prisma/prisma.service'
import { PhoneNumbersService } from './phone-numbers.service'
import { UsageService } from '../usage/usage.service'
import type { CoverageSettingsService } from '../coverage-settings/coverage-settings.service'
import type { BotStatusAlertService } from '../users/bot-status-alert.service'

const noCoverages = { listForAdmin: jest.fn().mockResolvedValue([]) } as unknown as CoverageSettingsService
const noAlerts = { notify: jest.fn().mockResolvedValue(undefined) } as unknown as BotStatusAlertService

describe('monthly phone number report', () => {
  function setup() {
    const prisma = {
      phoneNumber: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 1,
            number: '+5493416000000',
            phoneNumberId: 'PN',
            isActive: true,
            planId: null,
            servedCodes: [],
            responsibleProducerCode: null,
            usageMonthly: [
              {
                openaiCalls: 80,
                metaMessages: 1200,
                metaBillableMessages: 200,
                openaiInputTokens: 10000,
                openaiOutputTokens: 1000,
                totalCostUsd: 5.21,
                openaiCostUsd: 0.01,
                metaCostUsd: 5.2,
              },
            ],
          },
        ]),
      },
      // In service since August, so September is a full month.
      usageMonthly: { groupBy: jest.fn().mockResolvedValue([{ phoneNumberId: 1, _min: { period: '2026-08' } }]) },
      messagePlan: {
        findMany: jest.fn().mockResolvedValue([
          { id: 9, name: 'Prueba', messages: 100, priceUsd: 0, isTrial: true, isActive: true },
          { id: 1, name: 'Inicial', messages: 500, priceUsd: 25, isTrial: false, isActive: true },
          { id: 2, name: 'Profesional', messages: 1000, priceUsd: 50, isTrial: false, isActive: true },
        ]),
      },
      usageEvent: { groupBy: jest.fn().mockResolvedValue([]) },
      userProducerCode: { findMany: jest.fn().mockResolvedValue([{ producerCodeId: 11 }]) },
    }
    const usage = new UsageService(prisma as any, { get: () => undefined } as unknown as ConfigService, {} as any)
    return { prisma, service: new PhoneNumbersService(prisma as any, usage as any, noCoverages, noAlerts) }
  }

  const ownerOnly = ['totalCostUsd', 'marginUsd', 'metaBillableMessages', 'openaiCostUsd', 'metaCostUsd']

  it('shows an admin the messages of the month and its plan, never our cost', async () => {
    const { service, prisma } = setup()
    const [row] = await service.list(2, Role.ADMIN, '2026-09')
    expect(prisma.phoneNumber.findMany.mock.calls[0][0]).toMatchObject({
      where: { producerId: 2, deletedAt: null },
      select: { usageMonthly: { where: { period: '2026-09' } } },
    })
    // Its plan and what the month adds up to, but never our cost.
    const beyond = {
      id: null,
      name: 'Profesional + 1.000',
      includedMessages: 2000,
      priceUsd: 100,
      trial: false,
      extraBlocks: 1,
    }
    expect(row.usage).toEqual({
      period: '2026-09',
      messages: 1200,
      assignedPlan: { id: 1, name: 'Inicial', includedMessages: 500, priceUsd: 25, trial: false, extraBlocks: 0 },
      plan: beyond,
      upgraded: true,
      prorated: false,
      billedUsd: 100,
    })
    for (const field of ownerOnly) expect(row.usage).not.toHaveProperty(field)
    expect(row).not.toHaveProperty('monthlyBudgetUsd')
    expect(row).not.toHaveProperty('budgetExceededAt')
  })

  it('shows a superadmin the messages and the OpenAI calls and tokens, without our cost', async () => {
    const { service } = setup()
    const [row] = await service.list(2, Role.SUPERADMIN, '2026-09')
    expect(row.usage).toMatchObject({
      messages: 1200,
      metaMessages: 1200,
      openaiCalls: 80,
      inputTokens: 10000,
      outputTokens: 1000,
    })
    for (const field of ownerOnly) expect(row.usage).not.toHaveProperty(field)
    expect(row).not.toHaveProperty('monthlyBudgetUsd')
    expect(row).toHaveProperty('budgetExceededAt')
  })

  it('shows the owner the plan it bills, what Meta and OpenAI cost and the profit against Meta', async () => {
    const { service } = setup()
    const [row] = await service.list(2, Role.OWNER, '2026-09')
    expect(row.usage).toMatchObject({
      messages: 1200,
      openaiCalls: 80,
      plan: { name: 'Profesional + 1.000', includedMessages: 2000, priceUsd: 100 },
      billedUsd: 100,
      metaCostUsd: 5.2,
      openaiCostUsd: 0.01,
      totalCostUsd: 5.21,
      marginUsd: 94.8,
      metaBillableMessages: 200,
    })
    expect(row).toHaveProperty('monthlyBudgetUsd')
  })

  it('lets only the owner set the AI budget of a number', async () => {
    const { service, prisma } = setup()
    await service.update(1, 2, { number: '+5493416000001', monthlyBudgetUsd: 500 }, Role.SUPERADMIN)
    expect(prisma.phoneNumber.update.mock.calls[0][0].data).toEqual({ number: '+5493416000001' })
    await service.update(1, 2, { monthlyBudgetUsd: 30 }, Role.OWNER)
    expect(prisma.phoneNumber.update.mock.calls[1][0].data).toEqual({ monthlyBudgetUsd: 30 })
  })

  it('lists to an admin only the numbers billed to one of their codes', async () => {
    const { service, prisma } = setup()
    const [row] = (await prisma.phoneNumber.findMany()) as Record<string, unknown>[]
    prisma.phoneNumber.findMany.mockClear()
    prisma.phoneNumber.findMany.mockResolvedValueOnce([
      {
        ...row,
        botName: 'Sofi',
        staffNames: null,
        businessHours: null,
        botProfile: null,
        responsibleProducerCode: { id: 11, code: '11425', holderName: null },
      },
    ])

    const [mine] = await service.list(2, Role.ADMIN, '2026-09', 4)

    expect(prisma.userProducerCode.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 4 } }))
    expect(prisma.phoneNumber.findMany.mock.calls[0][0].where).toEqual({
      producerId: 2,
      deletedAt: null,
      responsibleProducerCodeId: { in: [11] },
    })
    expect(mine).toMatchObject({ canConfigureAssistant: true, assistant: { botName: 'Sofi', customized: true } })
  })

  it('lists every number of the organization to the superadmin', async () => {
    const { service, prisma } = setup()
    const [any] = await service.list(2, Role.SUPERADMIN, '2026-09', 2)
    expect(prisma.phoneNumber.findMany.mock.calls[0][0].where).toEqual({ producerId: 2, deletedAt: null })
    expect(prisma.userProducerCode.findMany).not.toHaveBeenCalled()
    expect(any.canConfigureAssistant).toBe(true)
  })

  it('rejects invalid and future month selectors', async () => {
    const { service, prisma } = setup()
    await expect(service.list(2, Role.OWNER, '2026-13')).rejects.toThrow('Mes inválido')
    await expect(service.list(2, Role.OWNER, '2099-01')).rejects.toThrow('Mes inválido')
    expect(prisma.phoneNumber.findMany).not.toHaveBeenCalled()
  })
})

describe("a number's own assistant", () => {
  const organization = {
    name: 'Seguros Norte SRL',
    botName: 'Nico',
    staffNames: 'Mili, Milagros',
    businessHours: null,
    botProfile: { orgName: 'Seguros Norte', towTruckPhone: '0800-111-2222' },
  }

  function setup(number: Record<string, unknown> = {}, userCodes: number[] = []) {
    const stored = {
      id: 8,
      number: '+54 9 341 000-0000',
      responsibleProducerCodeId: 11,
      botName: null,
      staffNames: null,
      businessHours: null,
      botProfile: null,
      producer: organization,
      ...number,
    }
    const prisma = {
      phoneNumber: {
        findFirst: jest.fn().mockResolvedValue(stored),
        update: jest.fn().mockResolvedValue({}),
      },
      userProducerCode: {
        findMany: jest.fn().mockResolvedValue(userCodes.map(producerCodeId => ({ producerCodeId }))),
      },
      botStatusChange: { findFirst: jest.fn().mockResolvedValue(null) },
      businessClosure: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 30,
            startDate: new Date('2026-11-23T00:00:00Z'),
            endDate: new Date('2026-11-23T00:00:00Z'),
            reason: 'feriado nacional: Soberanía Nacional',
            source: 'holiday',
          },
        ]),
        findFirst: jest.fn().mockResolvedValue({ id: 30 }),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 31, source: null, ...data })),
        update: jest.fn().mockResolvedValue({}),
      },
    }
    const service = new PhoneNumbersService(
      prisma as unknown as PrismaService,
      {} as UsageService,
      noCoverages,
      noAlerts,
    )
    return { prisma, service }
  }

  const superAdmin = { id: 2, producerId: 1, role: Role.SUPERADMIN }
  const admin = { id: 4, producerId: 1, role: Role.ADMIN }

  it("shows the number's settings next to the organization's that fill the gaps", async () => {
    const { service } = setup({ botName: 'Sofi', botProfile: { orgName: 'Seguros Norte Rafaela' } })

    const view = await service.getAssistant(8, superAdmin)

    expect(view).toMatchObject({
      canEdit: true,
      own: { botName: 'Sofi', staffNames: [], businessHours: null, botProfile: { orgName: 'Seguros Norte Rafaela' } },
      organization: { name: 'Seguros Norte SRL', botName: 'Nico', staffNames: ['Mili', 'Milagros'] },
    })
    expect(view.own.botProfile.towTruckPhone).toBeNull()
    expect(view.organization.botProfile.towTruckPhone).toBe('0800-111-2222')
    // The number's own holidays; there is no organization-wide switch any more.
    expect(view.own.closures).toEqual([
      {
        id: 30,
        startDate: '2026-11-23',
        endDate: '2026-11-23',
        reason: 'feriado nacional: Soberanía Nacional',
        holiday: true,
      },
    ])
    expect(view.organization).not.toHaveProperty('botEnabled')
  })

  it("closes and reopens only this number: a branch's holiday never closes the others", async () => {
    const { service, prisma } = setup({}, [11])

    await expect(
      service.addClosure(8, admin, {
        startDate: '2026-12-24',
        endDate: '2026-12-26',
        reason: ' Vacaciones de la sucursal ',
      }),
    ).resolves.toEqual({
      id: 31,
      startDate: '2026-12-24',
      endDate: '2026-12-26',
      reason: 'Vacaciones de la sucursal',
      holiday: false,
    })
    expect(prisma.businessClosure.create.mock.calls[0][0].data).toMatchObject({ producerId: 1, phoneNumberId: 8 })

    await expect(service.removeClosure(8, 30, admin)).resolves.toEqual({ ok: true })
    expect(prisma.businessClosure.findFirst.mock.calls[0][0].where).toMatchObject({ id: 30, phoneNumberId: 8 })

    await expect(
      service.addClosure(8, admin, { startDate: '2026-12-26', endDate: '2026-12-24', reason: 'Al revés' }),
    ).rejects.toThrow('posterior')
  })

  it("refuses the holidays of a number outside an admin's codes", async () => {
    const { service, prisma } = setup({}, [99])

    await expect(
      service.addClosure(8, admin, { startDate: '2026-12-24', endDate: '2026-12-24', reason: 'x' }),
    ).rejects.toThrow('not found')
    expect(prisma.businessClosure.create).not.toHaveBeenCalled()
  })

  it('saves only what the number changes and gives back the rest to the organization', async () => {
    const { service, prisma } = setup({
      botProfile: { transferAlias: 'NORTE.VIEJO', orgName: 'Seguros Norte Rafaela' },
    })

    await service.updateAssistant(8, superAdmin, {
      botName: ' Sofi ',
      staffNames: ['Caro', 'caro', ' '],
      businessHours: { mon: [{ from: '09:00', to: '13:00' }] },
      botProfile: { transferAlias: 'NORTE.RAFAELA', orgName: '' },
    })

    expect(prisma.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: {
        botName: 'Sofi',
        staffNames: 'Caro',
        businessHours: { mon: [{ from: '09:00', to: '13:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
        botProfile: { transferAlias: 'NORTE.RAFAELA' },
      },
    })
  })

  it('clears every setting back to the organization', async () => {
    const { service, prisma } = setup({ botName: 'Sofi', businessHours: { mon: [] }, botProfile: { orgName: 'X' } })

    await service.updateAssistant(8, superAdmin, {
      botName: '',
      staffNames: [],
      businessHours: null,
      botProfile: { orgName: '' },
    })

    expect(prisma.phoneNumber.update.mock.calls[0][0].data).toEqual({
      botName: null,
      staffNames: null,
      businessHours: Prisma.DbNull,
      botProfile: Prisma.DbNull,
    })
  })

  it('lets an admin read and change the numbers billed to one of their codes, and no other', async () => {
    const own = setup({}, [11])
    await expect(own.service.updateAssistant(8, admin, { botName: 'Sofi' })).resolves.toMatchObject({ canEdit: true })

    const other = setup({}, [12])
    await expect(other.service.updateAssistant(8, admin, { botName: 'Sofi' })).rejects.toBeInstanceOf(NotFoundException)
    expect(other.prisma.phoneNumber.update).not.toHaveBeenCalled()
    await expect(other.service.getAssistant(8, admin)).rejects.toBeInstanceOf(NotFoundException)
  })

  it('rejects malformed hours', async () => {
    const { service, prisma } = setup()
    await expect(
      service.updateAssistant(8, superAdmin, { businessHours: { mon: [{ from: '14:00', to: '09:00' }] } }),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(prisma.phoneNumber.update).not.toHaveBeenCalled()
  })
})

describe("a number's own bot switch", () => {
  function setup(stored: Record<string, unknown> = {}, userCodes: number[] = []) {
    const phone = {
      id: 8,
      number: '+54 9 341 000-0000',
      botEnabled: true,
      responsibleProducerCodeId: 11,
      producer: { name: 'Seguros Norte SRL' },
      ...stored,
    }
    const prisma = {
      phoneNumber: { findFirst: jest.fn().mockResolvedValue(phone), update: jest.fn().mockResolvedValue({ id: 8 }) },
      botStatusChange: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ createdAt: new Date('2026-10-28T15:00:00.000Z') }),
      },
      user: { findFirst: jest.fn().mockResolvedValue({ email: 'sucursal@norte.test' }) },
      userProducerCode: {
        findMany: jest.fn().mockResolvedValue(userCodes.map(producerCodeId => ({ producerCodeId }))),
      },
      $transaction: jest.fn().mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops)),
    }
    const alerts = { notify: jest.fn().mockResolvedValue(undefined) }
    const service = new PhoneNumbersService(
      prisma as unknown as PrismaService,
      {} as UsageService,
      noCoverages,
      alerts as unknown as BotStatusAlertService,
    )
    return { prisma, service, alerts }
  }

  it('lets the admin of the number switch it off, audits it and announces it', async () => {
    const { service, prisma, alerts } = setup({}, [11])

    const result = await service.setBotEnabled(8, { id: 4, producerId: 1, role: Role.ADMIN }, false)

    expect(result).toMatchObject({ id: 8, botEnabled: false })
    expect(prisma.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { botEnabled: false },
      select: { id: true },
    })
    expect(prisma.botStatusChange.create).toHaveBeenCalledWith({
      data: { producerId: 1, phoneNumberId: 8, botEnabled: false, userId: 4 },
      select: { createdAt: true },
    })
    expect(alerts.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        producerName: 'Seguros Norte SRL · +54 9 341 000-0000',
        botEnabled: false,
        actorEmail: 'sucursal@norte.test',
      }),
    )
  })

  it('does nothing when the number is already in that state', async () => {
    const { service, prisma, alerts } = setup({ botEnabled: false })

    await service.setBotEnabled(8, { id: 2, producerId: 1, role: Role.SUPERADMIN }, false)

    expect(prisma.phoneNumber.update).not.toHaveBeenCalled()
    expect(alerts.notify).not.toHaveBeenCalled()
  })

  it('refuses an admin on a number that is not billed to one of their codes', async () => {
    const { service, prisma } = setup({}, [12])

    await expect(service.setBotEnabled(8, { id: 4, producerId: 1, role: Role.ADMIN }, false)).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(prisma.phoneNumber.update).not.toHaveBeenCalled()
  })
})

describe("a number's own coverages", () => {
  function setup() {
    const prisma = {
      phoneNumber: {
        findFirst: jest.fn().mockResolvedValue({
          id: 8,
          number: '+54 9 341 000-0000',
          responsibleProducerCodeId: 11,
          botName: null,
          staffNames: null,
          businessHours: null,
          botProfile: null,
          botEnabled: true,
          coverageSettings: { A: { isActive: false } },
          producer: {
            name: 'Seguros Norte SRL',
            botName: 'Nico',
            staffNames: null,
            businessHours: null,
            botProfile: null,
          },
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      userProducerCode: { findMany: jest.fn().mockResolvedValue([]) },
      botStatusChange: { findFirst: jest.fn().mockResolvedValue(null) },
      businessClosure: { findMany: jest.fn().mockResolvedValue([]) },
    }
    const coverages = {
      listForAdmin: jest.fn().mockResolvedValue([
        {
          id: 1,
          code: 'A',
          name: 'Responsabilidad civil',
          isActive: true,
          highlighted: false,
          sortOrder: 100,
          needsReview: false,
        },
        {
          id: 2,
          code: 'C1',
          name: 'Terceros completo',
          isActive: true,
          highlighted: true,
          sortOrder: 300,
          needsReview: false,
        },
      ]),
    }
    const service = new PhoneNumbersService(
      prisma as unknown as PrismaService,
      {} as UsageService,
      coverages as unknown as CoverageSettingsService,
      noAlerts,
    )
    return { prisma, service }
  }
  const superAdmin = { id: 2, producerId: 1, role: Role.SUPERADMIN }

  it("shows the number's own choices next to the organization's coverages", async () => {
    const { service } = setup()

    const view = await service.getAssistant(8, superAdmin)

    expect(view.own.coverageSettings).toEqual({ A: { isActive: false, highlighted: null, sortOrder: null } })
    expect(view.organization.coverages.map(c => [c.code, c.isActive, c.highlighted])).toEqual([
      ['A', true, false],
      ['C1', true, true],
    ])
  })

  it('saves only what the number changes and refuses a code the organization does not have', async () => {
    const { service, prisma } = setup()

    await service.updateAssistant(8, superAdmin, {
      coverageSettings: { C1: { highlighted: false, sortOrder: 1 }, A: { isActive: null } },
    })
    expect(prisma.phoneNumber.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { coverageSettings: { C1: { isActive: null, highlighted: false, sortOrder: 1 } } },
    })

    await expect(
      service.updateAssistant(8, superAdmin, { coverageSettings: { Z9: { isActive: true } } }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('gives the coverages back to the organization with null', async () => {
    const { service, prisma } = setup()

    await service.updateAssistant(8, superAdmin, { coverageSettings: null })

    expect(prisma.phoneNumber.update.mock.calls[0][0].data).toEqual({ coverageSettings: Prisma.DbNull })
  })
})
