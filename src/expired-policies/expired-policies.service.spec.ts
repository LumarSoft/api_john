import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import type { BotNotifierService } from '../inbox/bot-notifier.service'
import type { NoticeDeliveryService } from '../notices/notice-delivery.service'
import { ExpiredPoliciesService } from './expired-policies.service'
import { ExpiredPolicySort } from './dto/list-expired-policies.dto'
import { expiryNoticeParams, renderExpiryNotice } from './expiry-notice'

const now = new Date('2026-10-28T15:00:00Z')

function build(prisma: Record<string, unknown>, template: string | null = 'aviso_poliza_vencida') {
  const botNotifier = { sendTemplate: jest.fn().mockResolvedValue(undefined) }
  const delivery = {
    senders: jest.fn().mockResolvedValue([{ phoneNumberId: 'meta-1', codeIds: [7] }]),
    knownWaIds: jest.fn().mockResolvedValue(new Set<string>()),
    findConversation: jest.fn().mockResolvedValue(null),
    recordInChat: jest.fn().mockResolvedValue(99),
  }
  const config = { get: (key: string) => (key === 'POLICY_EXPIRY_TEMPLATE' ? (template ?? undefined) : undefined) }
  const service = new ExpiredPoliciesService(
    prisma as unknown as PrismaService,
    botNotifier as unknown as BotNotifierService,
    delivery as unknown as NoticeDeliveryService,
    config as unknown as ConfigService,
  )
  return { service, botNotifier, delivery }
}

describe('ExpiredPoliciesService.list', () => {
  const client = (id: number, lastName: string) => ({
    id,
    firstName: 'Ana',
    lastName,
    dni: String(id),
    phone: null,
    email: null,
  })
  const expired = (
    id: number,
    clientId: number,
    validTo: string,
    vehicle: { licensePlate: string | null; brand?: string; model?: string; year?: number } | null,
    riskType = 'auto',
  ) => ({
    id,
    certificateNumber: String(1000 + id),
    riskType,
    validTo: new Date(validTo),
    paymentMethod: 'Convenio',
    rawData: {},
    hiddenAt: null,
    hiddenReason: null,
    clientId,
    producerCode: { id: 7, code: '14831' },
    client: client(clientId, `Cliente ${clientId}`),
    vehicle,
    installments: [],
    expiryNotices: [],
  })

  function setup(candidates: unknown[], current: unknown[]) {
    const findMany = jest.fn().mockResolvedValueOnce(candidates).mockResolvedValueOnce(current)
    const count = jest.fn().mockResolvedValue(2)
    const { service } = build({ policy: { findMany, count } })
    return { service, findMany }
  }

  it('leaves out the policies renewed on the same plate, or on the same risk when there is no plate', async () => {
    const { service } = setup(
      [
        expired(1, 10, '2026-09-01', { licensePlate: 'AB 123 CD' }),
        expired(2, 10, '2026-08-01', { licensePlate: 'ZZ999ZZ' }),
        expired(3, 11, '2026-07-01', null, 'life'),
        expired(4, 12, '2026-06-01', null, 'life'),
      ],
      [
        { clientId: 10, riskType: 'auto', vehicle: { licensePlate: 'ab123cd' } },
        { clientId: 11, riskType: 'life', vehicle: null },
      ],
    )

    const page = await service.list(1, [7], {}, now)

    expect(page.data.map(r => r.id)).toEqual([4, 2])
    expect(page.total).toBe(2)
    expect(page.hiddenCount).toBe(2)
    expect(page.templateReady).toBe(true)
  })

  it('puts the longest expired first by default and the most recent first on request', async () => {
    const rows = [
      expired(1, 10, '2026-10-20', { licensePlate: 'A1' }),
      expired(2, 11, '2026-05-20', { licensePlate: 'B2' }),
    ]
    const oldest = await setup(rows, []).service.list(1, [7], {}, now)
    expect(oldest.data.map(r => r.daysExpired)).toEqual([161, 8])

    const recent = await setup(rows, []).service.list(1, [7], { sort: ExpiredPolicySort.RECENT }, now)
    expect(recent.data.map(r => r.id)).toEqual([1, 2])
  })

  it('asks only for the codes, the medio de pago and the year window in scope', async () => {
    const { service, findMany } = setup([], [])

    await service.list(1, [7, 9], { paymentMethod: 'Plan De Pago', hidden: true }, now)

    const where = findMany.mock.calls[0][0].where
    expect(where).toMatchObject({
      producerId: 1,
      deletedAt: null,
      producerCodeId: { in: [7, 9] },
      paymentMethod: 'Plan De Pago',
      hiddenAt: { not: null },
      NOT: [{ lastMovement: { startsWith: 'ANUL' } }, { lastMovement: { startsWith: 'RESCISION' } }],
    })
    expect(where.validTo.lt).toEqual(now)
    expect(where.validTo.gte.toISOString()).toBe('2025-10-28T15:00:00.000Z')
    // Nobody to look up renewals for.
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it('describes the vehicle, the unpaid cuotas and the last notice of each row', async () => {
    const row = {
      ...expired(1, 10, '2026-09-01', { licensePlate: 'AB123CD', brand: 'FIAT', model: 'PALIO', year: 2024 }),
      installments: [{ id: 1 }, { id: 2 }],
      expiryNotices: [
        {
          id: 5,
          status: 'SENT',
          sentAt: new Date('2026-10-20T12:00:00Z'),
          createdAt: new Date('2026-10-20T11:59:00Z'),
          error: null,
        },
      ],
    }
    const { service } = setup([row], [])

    const page = await service.list(1, [7], {}, now)

    expect(page.data[0]).toMatchObject({
      certificateNumber: '1001',
      licensePlate: 'AB123CD',
      vehicle: 'FIAT PALIO 2024',
      daysExpired: 57,
      unpaidInstallments: 2,
      producerCode: { code: '14831' },
      notice: { id: 5, status: 'SENT', sentAt: '2026-10-20T12:00:00.000Z' },
    })
  })
})

describe('ExpiredPoliciesService.hide', () => {
  it('hides a policy of the codes in scope with the reason and who did it', async () => {
    const update = jest.fn().mockResolvedValue({ id: 5, hiddenAt: new Date(), hiddenReason: 'Vendió el auto' })
    const findFirst = jest.fn().mockResolvedValue({ id: 5 })
    const { service } = build({ policy: { findFirst, update } })

    await service.hide(5, 1, [7], 42, '  Vendió el auto ')

    expect(findFirst.mock.calls[0][0].where).toMatchObject({ id: 5, producerId: 1, producerCodeId: { in: [7] } })
    expect(update.mock.calls[0][0].data).toMatchObject({ hiddenReason: 'Vendió el auto', hiddenById: 42 })
    expect(update.mock.calls[0][0].data.hiddenAt).toBeInstanceOf(Date)
  })

  it('refuses a policy outside the user scope', async () => {
    const { service } = build({ policy: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } })

    await expect(service.unhide(5, 1, [7])).rejects.toThrow('Policy 5 not found')
  })
})

describe('ExpiredPoliciesService.send', () => {
  const user = { id: 42, producerId: 1 }
  const sendable = (id: number, phone: string | null, expiryNotices: Array<{ status: string }> = []) => ({
    id,
    producerCodeId: 7,
    clientId: 10 + id,
    client: { phone, deletedAt: null },
    expiryNotices,
  })

  function setup(policies: unknown[], template: string | null = 'aviso_poliza_vencida') {
    let nextId = 100
    const prisma = {
      policy: { findMany: jest.fn().mockResolvedValue(policies) },
      policyExpiryNotice: {
        create: jest.fn().mockImplementation(() => Promise.resolve({ id: nextId++ })),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          id: 100,
          waId: '5493415551234',
          producerId: 1,
          producerCodeId: 7,
          clientId: 11,
          client: { firstName: 'ana maría' },
          policy: {
            certificateNumber: '1763551',
            riskType: 'auto',
            validTo: new Date('2026-08-14T00:00:00Z'),
            rawData: {},
            vehicle: { licensePlate: 'AB123CD' },
          },
          producer: { name: 'JOHN PELLEGRINI MANAGEMENT GROUP SRL', botProfile: { orgName: 'John Pellegrini' } },
        }),
      },
    }
    return { prisma, ...build(prisma, template) }
  }

  it('refuses to send while the Meta template is not configured', async () => {
    const { service } = setup([sendable(1, '341 555-1234')], null)

    await expect(service.send(user, [7], [1], now)).rejects.toThrow('todavía no está habilitada')
  })

  it('claims a notice per policy with a phone and leaves out the ones already told or without one', async () => {
    const { service, prisma } = setup([
      sendable(1, '341 555-1234'),
      sendable(2, null),
      sendable(3, '341 555-9999', [{ status: 'SENT' }]),
      sendable(4, '341 555-8888', [{ status: 'SENDING' }]),
    ])

    const result = await service.send(user, [7], [1, 2, 3, 4], now)

    expect(result).toEqual({
      sent: 1,
      skipped: [
        { policyId: 2, reason: 'NO_PHONE' },
        { policyId: 3, reason: 'ALREADY_NOTIFIED' },
        { policyId: 4, reason: 'SENDING' },
      ],
    })
    expect(prisma.policyExpiryNotice.create).toHaveBeenCalledTimes(1)
    expect(prisma.policyExpiryNotice.create.mock.calls[0][0].data).toMatchObject({
      status: 'SENDING',
      policyId: 1,
      clientId: 11,
      waId: '5493415551234',
      sentById: 42,
    })
    // Only visible, not cancelled, expired policies of the codes in scope can be sent.
    expect(prisma.policy.findMany.mock.calls[0][0].where).toMatchObject({
      id: { in: [1, 2, 3, 4] },
      producerCodeId: { in: [7] },
      hiddenAt: null,
    })
  })

  it('sends the template with the client, organization, policy, plate and date, and records it in the chat', async () => {
    const { service, prisma, botNotifier, delivery } = setup([sendable(1, '341 555-1234')])

    await service.send(user, [7], [1], now)
    // The delivery runs in the background.
    await new Promise(resolve => setTimeout(resolve, 20))

    const params = ['Ana', 'John Pellegrini', '1763551', 'AB123CD', '14/08/2026']
    expect(botNotifier.sendTemplate).toHaveBeenCalledWith({
      to: '5493415551234',
      phoneNumberId: 'meta-1',
      template: 'aviso_poliza_vencida',
      lang: 'es_AR',
      params,
    })
    expect(delivery.recordInChat).toHaveBeenCalledWith(
      { waId: '5493415551234', producerId: 1, producerCodeId: 7, clientId: 11 },
      null,
      'meta-1',
      renderExpiryNotice(params),
      { policyExpiryNoticeId: 100, notice: 'policy_expiry' },
    )
    expect(prisma.policyExpiryNotice.update.mock.calls[0][0].data).toMatchObject({ status: 'SENT', conversationId: 99 })
  })

  it('marks the policies as told by hand, except one whose notice is still going out', async () => {
    const { service, prisma } = setup([sendable(1, null), sendable(2, '341 555-8888', [{ status: 'SENDING' }])])

    await expect(service.mark(user, [7], [1, 2], now)).resolves.toEqual({ marked: 1 })

    const data = prisma.policyExpiryNotice.createMany.mock.calls[0][0].data
    expect(data).toEqual([expect.objectContaining({ status: 'MARKED', policyId: 1, sentAt: now, sentById: 42 })])
  })
})

describe('expiry notice text', () => {
  it('reads as the approved template with the client greeted by first name', () => {
    const params = expiryNoticeParams({
      clientFirstName: 'MARÍA  JOSÉ',
      organizationName: 'John Pellegrini',
      certificateNumber: '1763551',
      item: 'AB123CD',
      validTo: new Date('2026-08-14T00:00:00Z'),
    })
    expect(params).toEqual(['María', 'John Pellegrini', '1763551', 'AB123CD', '14/08/2026'])
    expect(renderExpiryNotice(params)).toBe(
      'Hola María, te escribimos de John Pellegrini, tu productor de seguros. Tu póliza 1763551 (AB123CD) venció el 14/08/2026. Si querés renovarla o cotizar otra opción, respondé este mensaje y te ayudamos.',
    )
  })
})
