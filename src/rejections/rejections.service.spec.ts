import { Prisma, Role } from 'generated/prisma/client'
import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import type { ScopeService } from '../common/scope/scope.service'
import type { BotNotifierService } from '../inbox/bot-notifier.service'
import type { PaymentRejectionRowDto } from './dto/payment-rejection.dto'
import { RejectionsService, pickSender, pickWhatsApp } from './rejections.service'

const mili = { id: 2, producerId: 7, role: Role.ADMIN }

/** A row as the panel reads it from Triunfo's Excel (fictitious data). */
function excelRow(overrides: Partial<PaymentRejectionRowDto> = {}): PaymentRejectionRowDto {
  return {
    rowNumber: 5,
    holderName: 'PEREZ JUAN CARLOS',
    branch: 465,
    certificateNumber: '1234567',
    endorsementNumber: 0,
    installmentNumber: 2,
    dueDate: '2026-09-28',
    amount: 90315,
    entity: 'NACION ARGENTINA',
    accountLast4: '6025',
    reason: 'FALTA DE FONDOS',
    stillPending: true,
    mobilePhone: '341159990001',
    homePhone: '341159990001',
    ...overrides,
  }
}

function setup(template: string | null = 'aviso_rechazo_pago') {
  const prisma = {
    policy: { findMany: jest.fn().mockResolvedValue([]) },
    producerCode: { findFirst: jest.fn().mockResolvedValue({ id: 3 }) },
    conversation: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 40 }),
      update: jest.fn().mockResolvedValue({}),
    },
    message: { create: jest.fn().mockResolvedValue({ createdAt: new Date('2026-10-20T18:00:00Z') }) },
    phoneNumber: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { phoneNumberId: 'meta-1', wabaAccountId: 1, responsibleProducerCodeId: 1, servedCodes: [] },
        ]),
    },
    paymentRejection: {
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    paymentRejectionImport: {
      create: jest.fn().mockResolvedValue({ id: 9 }),
      findFirst: jest.fn().mockResolvedValue({ id: 9, fileName: 'x.xls', periodLabel: null, createdAt: new Date() }),
    },
    $transaction: jest.fn(),
  }
  prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma))
  const scope = {
    resolveAccessibleProducerCodeIds: jest.fn().mockResolvedValue([1, 3]),
    canAccessCode: jest.fn().mockResolvedValue(true),
  }
  const botNotifier = { sendTemplate: jest.fn().mockResolvedValue(undefined) }
  const config = {
    get: jest.fn((key: string) => (key === 'PAYMENT_REJECTION_TEMPLATE' ? (template ?? undefined) : undefined)),
  }
  const service = new RejectionsService(
    prisma as unknown as PrismaService,
    scope as unknown as ScopeService,
    botNotifier as unknown as BotNotifierService,
    config as unknown as ConfigService,
  )
  return { service, prisma, scope, botNotifier }
}

/** The rows `create` stored, from the nested createMany. */
function storedRows(prisma: ReturnType<typeof setup>['prisma']) {
  const call = prisma.paymentRejectionImport.create.mock.calls[0][0] as {
    data: { rejections: { createMany: { data: Array<Record<string, unknown>> } } }
  }
  return call.data.rejections.createMany.data
}

describe('RejectionsService.create', () => {
  it('matches the policy, writes to the mobile and leaves it ready to send', async () => {
    const { service, prisma } = setup()
    prisma.policy.findMany.mockResolvedValue([
      { id: 50, certificateNumber: '1234567', producerCodeId: 1, client: { id: 60, phone: null, deletedAt: null } },
    ])

    await service.create(mili, { fileName: 'rechazos.xls', producerCode: '10484', rows: [excelRow()] })

    expect(storedRows(prisma)[0]).toEqual(
      expect.objectContaining({
        waId: '5493419990001',
        status: 'READY',
        skipReason: null,
        channel: 'ACCOUNT',
        policyId: 50,
        clientId: 60,
        producerCodeId: 1,
        dueDate: new Date('2026-09-28T00:00:00.000Z'),
      }),
    )
  })

  it('leaves out a paid installment, one already told and one without a usable phone', async () => {
    const { service, prisma } = setup()
    prisma.paymentRejection.findMany.mockResolvedValueOnce([
      { certificateNumber: '7654321', installmentNumber: 1, dueDate: new Date('2026-09-10T00:00:00.000Z') },
    ])

    await service.create(mili, {
      fileName: 'rechazos.xls',
      rows: [
        excelRow({ stillPending: false }),
        excelRow({ rowNumber: 6, certificateNumber: '7654321', installmentNumber: 1, dueDate: '2026-09-10' }),
        excelRow({ rowNumber: 7, mobilePhone: '1', homePhone: '' }),
      ],
    })

    expect(storedRows(prisma).map(r => [r.status, r.skipReason])).toEqual([
      ['SKIPPED', 'ALREADY_PAID'],
      ['SKIPPED', 'ALREADY_NOTIFIED'],
      ['SKIPPED', 'NO_PHONE'],
    ])
  })

  it('refuses an Excel of a code the admin cannot see', async () => {
    const { service, prisma, scope } = setup()
    scope.canAccessCode.mockResolvedValue(false)

    await expect(
      service.create(mili, { fileName: 'rechazos.xls', producerCode: '10484', rows: [excelRow()] }),
    ).rejects.toThrow('No tenés acceso al código 10484')
    expect(prisma.paymentRejectionImport.create).not.toHaveBeenCalled()
  })
})

describe('RejectionsService.send', () => {
  it('does nothing until the template is configured', async () => {
    const { service, prisma } = setup(null)

    await expect(service.send(mili, 9, [1])).rejects.toThrow('plantilla')
    expect(prisma.paymentRejection.updateMany).not.toHaveBeenCalled()
  })

  it('claims each row once so a double click never sends twice', async () => {
    const { service, prisma } = setup()
    prisma.paymentRejection.findMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]).mockResolvedValue([])
    prisma.paymentRejection.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    prisma.paymentRejection.findUniqueOrThrow.mockResolvedValue({
      id: 1,
      holderName: 'PEREZ JUAN',
      certificateNumber: '1234567',
      installmentNumber: 2,
      dueDate: new Date('2026-09-28T00:00:00.000Z'),
      amount: new Prisma.Decimal(90315),
      reason: 'FALTA DE FONDOS',
      waId: '5493419990001',
      producerId: 7,
      producerCodeId: 1,
      clientId: 60,
      client: { firstName: 'JUAN' },
    })
    const { botNotifier } = setupSend(service)

    await service.send(mili, 9, [1, 2])
    await flush()

    expect(botNotifier.sendTemplate).toHaveBeenCalledTimes(1)
    expect(botNotifier.sendTemplate).toHaveBeenCalledWith({
      to: '5493419990001',
      phoneNumberId: 'meta-1',
      template: 'aviso_rechazo_pago',
      lang: 'es_AR',
      params: ['Juan', '2', '1234567', '28/09/2026', '90.315', 'falta de fondos en la cuenta'],
    })
    // The notice is the office's message in a new chat linked to the client.
    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ waId: '5493419990001', clientId: 60, phoneNumberId: 'meta-1' }),
      select: { id: true },
    })
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ conversationId: 40, role: 'agent', rawData: { paymentRejectionId: 1 } }),
      select: { createdAt: true },
    })
    expect(prisma.paymentRejection.update).toHaveBeenLastCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ status: 'SENT', conversationId: 40 }),
    })
  })

  it('keeps the reason WhatsApp gave when it refuses the notice', async () => {
    const { service, prisma } = setup()
    prisma.paymentRejection.findMany.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValue([])
    prisma.paymentRejection.findUniqueOrThrow.mockResolvedValue({
      id: 1,
      holderName: 'PEREZ JUAN',
      certificateNumber: '1234567',
      installmentNumber: 2,
      dueDate: new Date('2026-09-28T00:00:00.000Z'),
      amount: new Prisma.Decimal(90315),
      reason: 'FALTA DE FONDOS',
      waId: '5493419990001',
      producerId: 7,
      producerCodeId: null,
      clientId: null,
      client: null,
    })
    const { BadGatewayException } = jest.requireActual<typeof import('@nestjs/common')>('@nestjs/common')
    const { botNotifier } = setupSend(service)
    botNotifier.sendTemplate.mockRejectedValue(new BadGatewayException('WhatsApp rechazó el mensaje (131026).'))

    await service.send(mili, 9, [1])
    await flush()

    expect(prisma.message.create).not.toHaveBeenCalled()
    expect(prisma.paymentRejection.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'FAILED', error: 'WhatsApp rechazó el mensaje (131026).' },
    })
  })
})

describe('pickWhatsApp', () => {
  it('prefers the first phone that reads as one WhatsApp id', () => {
    expect(pickWhatsApp(['1', '341159990001'], new Set())).toEqual({
      phone: '341159990001',
      waId: '5493419990001',
    })
  })

  it('takes an ambiguous mobile only when one reading already wrote to us', () => {
    // 11 15 1512 3456: the 15 could sit after "11" or after "1115".
    const ambiguous = '111515123456'
    expect(pickWhatsApp([ambiguous], new Set())).toBeNull()
    expect(pickWhatsApp([ambiguous], new Set(['5491115123456']))).toEqual({
      phone: ambiguous,
      waId: '5491115123456',
    })
  })
})

describe('pickSender', () => {
  const senders = [
    { phoneNumberId: 'office', codeIds: [1] },
    { phoneNumberId: 'branch', codeIds: [3] },
  ]

  it('keeps the number the client already talks to', () => {
    expect(pickSender(senders, 'branch', 1)).toBe('branch')
  })

  it('uses the number of the policy code, else the first', () => {
    expect(pickSender(senders, null, 3)).toBe('branch')
    expect(pickSender(senders, 'gone', null)).toBe('office')
  })
})

/** The send loop waits between notices; the tests skip the wait. */
function setupSend(service: RejectionsService) {
  jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void) => {
    fn()
    return 0
  }) as unknown as typeof setTimeout)
  const botNotifier = (service as unknown as { botNotifier: { sendTemplate: jest.Mock } }).botNotifier
  return { botNotifier }
}

/** Lets the background send loop finish. */
async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
