import { NotFoundException } from '@nestjs/common'
import type { ConfigService } from '@nestjs/config'
import type { MailService } from '../mail/mail.service'
import type { PrismaService } from '../prisma/prisma.service'
import { ProposalsService } from './proposals.service'

describe('ProposalsService', () => {
  const stored = {
    id: 3,
    title: 'Avisar al celular',
    description: 'Que me llegue un aviso cuando alguien pide un asesor',
    status: 'NEW',
    response: null,
    respondedAt: null,
    createdAt: new Date('2026-10-12T15:00:00Z'),
    authorId: 4,
    author: { email: 'mili@jpmg.com' },
    producer: { name: 'JPMG' },
  }

  function setup(env: Record<string, string> = {}, current: { response: string | null } | null = { response: null }) {
    const prisma = {
      improvementProposal: {
        findMany: jest.fn().mockResolvedValue([stored, { ...stored, id: 2, authorId: 9 }]),
        create: jest.fn().mockResolvedValue(stored),
        count: jest.fn().mockResolvedValue(2),
        findFirst: jest.fn().mockResolvedValue(current),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...stored, ...data })),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ email: 'owner@lumar.com' }]) },
    }
    const mail = { sendAlert: jest.fn().mockResolvedValue(undefined) }
    const config = { get: jest.fn((key: string) => env[key]) }
    const service = new ProposalsService(
      prisma as unknown as PrismaService,
      mail as unknown as MailService,
      config as unknown as ConfigService,
    )
    return { service, prisma, mail }
  }

  const flush = () => new Promise(resolve => setImmediate(resolve))

  it('shows the whole organization every proposal and marks the caller own ones', async () => {
    const { service, prisma } = setup()

    const list = await service.listForOrganization(1, 4)

    expect(prisma.improvementProposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { producerId: 1, deletedAt: null } }),
    )
    expect(list.map(p => p.mine)).toEqual([true, false])
    expect(list[0]).not.toHaveProperty('authorId')
  })

  it('saves the proposal for the caller and emails the owner accounts', async () => {
    const { service, prisma, mail } = setup()

    const created = await service.create(1, 4, { title: ' Avisar al celular ', description: 'Detalle' })
    await flush()

    expect(prisma.improvementProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { title: 'Avisar al celular', description: 'Detalle', producerId: 1, authorId: 4 },
      }),
    )
    expect(created).toEqual(expect.objectContaining({ id: 3, mine: true }))
    expect(created).not.toHaveProperty('producer')
    expect(mail.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['owner@lumar.com'], subject: 'Nueva propuesta de mejora: Avisar al celular' }),
    )
  })

  it('sends the alert to PROPOSALS_ALERT_EMAIL when it is set', async () => {
    const { service, prisma, mail } = setup({ PROPOSALS_ALERT_EMAIL: 'a@x.com, b@x.com' })

    await service.create(1, 4, { title: 'T', description: 'D' })
    await flush()

    expect(prisma.user.findMany).not.toHaveBeenCalled()
    expect(mail.sendAlert).toHaveBeenCalledWith(expect.objectContaining({ to: ['a@x.com', 'b@x.com'] }))
  })

  it('keeps the proposal when the email fails', async () => {
    const { service, mail } = setup()
    mail.sendAlert.mockRejectedValue(new Error('resend down'))

    await expect(service.create(1, 4, { title: 'T', description: 'D' })).resolves.toEqual(
      expect.objectContaining({ id: 3 }),
    )
    await flush()
  })

  it('stamps the answer date only when the answer changes', async () => {
    const { service, prisma } = setup({}, { response: 'Lo vemos' })

    await service.update(3, { status: 'PLANNED', response: 'Lo vemos' })
    expect(prisma.improvementProposal.update.mock.calls[0][0].data).toEqual({ status: 'PLANNED' })

    await service.update(3, { response: 'Sale la semana que viene' })
    expect(prisma.improvementProposal.update.mock.calls[1][0].data).toEqual({
      status: undefined,
      response: 'Sale la semana que viene',
      respondedAt: expect.any(Date),
    })

    await service.update(3, { response: '  ' })
    expect(prisma.improvementProposal.update.mock.calls[2][0].data).toEqual({
      status: undefined,
      response: null,
      respondedAt: null,
    })
  })

  it('404s on a missing proposal', async () => {
    const { service } = setup({}, null)
    await expect(service.update(99, { status: 'DONE' })).rejects.toBeInstanceOf(NotFoundException)
  })
})
