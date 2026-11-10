import { BadGatewayException, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { QuoteInsurersService } from './quote-insurers.service'
import { TriunfoNotConfiguredException } from '../triunfo/triunfo.service'
import type { PrismaService } from '../prisma/prisma.service'
import type { SancorService } from '../sancor/sancor.service'
import type { TriunfoErrorsService } from '../triunfo/triunfo-errors.service'
import type { TriunfoService } from '../triunfo/triunfo.service'

const CREDENTIALS = { productor: '1', usuario: 'u', password: 'p' }

function setup(producer = { slug: 'john', triunfoQuotesEnabled: true, sancorQuotesEnabled: false }) {
  const prisma = {
    producer: {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(producer)),
      update: jest.fn().mockImplementation(({ data }: { data: Partial<typeof producer> }) => {
        Object.assign(producer, data)
        return Promise.resolve(producer)
      }),
    },
  }
  const triunfo = {
    credentialsFor: jest.fn().mockResolvedValue(CREDENTIALS),
    verifyCredentials: jest.fn().mockResolvedValue(undefined),
  }
  const triunfoErrors = {
    authState: jest.fn().mockResolvedValue({ failingSince: null, failureMessage: null }),
    credentialsAccepted: jest.fn().mockResolvedValue(undefined),
  }
  const sancor = {
    missingFor: jest.fn().mockReturnValue([]),
    verifyToken: jest.fn().mockResolvedValue(undefined),
  }
  const service = new QuoteInsurersService(
    prisma as unknown as PrismaService,
    triunfo as unknown as TriunfoService,
    triunfoErrors as unknown as TriunfoErrorsService,
    sancor as unknown as SancorService,
  )
  return { service, prisma, triunfo, triunfoErrors, sancor, producer }
}

describe('QuoteInsurersService.status', () => {
  it('shows each switch, what it quotes and nothing missing when the credentials are there', async () => {
    const { service } = setup()
    await expect(service.status(1)).resolves.toEqual({
      triunfo: { enabled: true, products: ['Auto', 'Moto'], problems: [] },
      sancor: {
        enabled: false,
        products: ['Bolso protegido', 'Hogar', 'Bici', 'Accidentes personales'],
        problems: [],
      },
    })
  })

  it('lists what each insurer lacks, without calling them', async () => {
    const { service, triunfo, triunfoErrors, sancor } = setup()
    triunfoErrors.authState.mockResolvedValue({ failingSince: new Date(), failureMessage: 'Error Generando Token' })
    sancor.missingFor.mockReturnValue(['Falta el código de productor de Sancor.'])

    const status = await service.status(1)

    expect(status.triunfo.problems).toEqual([
      'Triunfo rechaza las credenciales de esta organización: Error Generando Token',
    ])
    expect(status.sancor.problems).toEqual(['Falta el código de productor de Sancor.'])
    expect(triunfo.verifyCredentials).not.toHaveBeenCalled()
    expect(sancor.verifyToken).not.toHaveBeenCalled()

    triunfo.credentialsFor.mockRejectedValue(new TriunfoNotConfiguredException(1))
    expect((await service.status(1)).triunfo.problems[0]).toMatch(/no tiene credenciales de Triunfo/)
  })

  it('answers 404 for an unknown organization', async () => {
    const { service, prisma } = setup()
    prisma.producer.findFirst.mockResolvedValue(null)
    await expect(service.status(9)).rejects.toBeInstanceOf(NotFoundException)
  })
})

describe('QuoteInsurersService.update', () => {
  it('turns Sancor on only after Sancor gives a token', async () => {
    const { service, sancor, prisma } = setup()

    const status = await service.update(1, { sancor: true })

    expect(sancor.missingFor).toHaveBeenCalledWith('john')
    expect(sancor.verifyToken).toHaveBeenCalled()
    expect(prisma.producer.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { sancorQuotesEnabled: true } })
    expect(status.sancor.enabled).toBe(true)
  })

  it('keeps Sancor off and says what is missing when the organization has no Sancor user', async () => {
    const { service, sancor, prisma } = setup({ slug: 'otra', triunfoQuotesEnabled: true, sancorQuotesEnabled: false })
    sancor.missingFor.mockReturnValue(['Esta organización todavía no tiene su usuario de Sancor (lo carga Lumarsoft).'])

    await expect(service.update(1, { sancor: true })).rejects.toThrow(/todavía no tiene su usuario de Sancor/)
    expect(sancor.verifyToken).not.toHaveBeenCalled()
    expect(prisma.producer.update).not.toHaveBeenCalled()
  })

  it('keeps Sancor off when Sancor refuses the login, and reports an unreachable Sancor apart', async () => {
    const { service, sancor, prisma } = setup()
    sancor.verifyToken.mockRejectedValueOnce(new UnauthorizedException('Usuario o contraseña incorrecta.'))
    await expect(service.update(1, { sancor: true })).rejects.toBeInstanceOf(BadRequestException)

    sancor.verifyToken.mockRejectedValueOnce(new Error('timeout'))
    await expect(service.update(1, { sancor: true })).rejects.toBeInstanceOf(BadGatewayException)
    expect(prisma.producer.update).not.toHaveBeenCalled()
  })

  it("turns Triunfo back on only after Triunfo gives a token with the organization's credentials", async () => {
    const { service, triunfo, triunfoErrors } = setup({
      slug: 'john',
      triunfoQuotesEnabled: false,
      sancorQuotesEnabled: false,
    })

    await service.update(1, { triunfo: true })

    expect(triunfo.credentialsFor).toHaveBeenCalledWith(1)
    expect(triunfo.verifyCredentials).toHaveBeenCalledWith(CREDENTIALS)
    expect(triunfoErrors.credentialsAccepted).toHaveBeenCalledWith(1)
  })

  it('keeps Triunfo off without credentials or with a refused password', async () => {
    const { service, triunfo, prisma } = setup({
      slug: 'otra',
      triunfoQuotesEnabled: false,
      sancorQuotesEnabled: false,
    })
    triunfo.credentialsFor.mockRejectedValueOnce(new TriunfoNotConfiguredException(1))
    await expect(service.update(1, { triunfo: true })).rejects.toThrow(/no tiene credenciales de Triunfo/)

    triunfo.verifyCredentials.mockRejectedValueOnce(new UnauthorizedException('Error Generando Token'))
    await expect(service.update(1, { triunfo: true })).rejects.toThrow(/Error Generando Token/)
    expect(prisma.producer.update).not.toHaveBeenCalled()
  })

  it('turns an insurer off without asking it anything, and does not re-check one already on', async () => {
    const { service, triunfo, sancor, prisma } = setup({
      slug: 'john',
      triunfoQuotesEnabled: true,
      sancorQuotesEnabled: true,
    })

    await service.update(1, { triunfo: false, sancor: true })

    expect(triunfo.verifyCredentials).not.toHaveBeenCalled()
    expect(sancor.verifyToken).not.toHaveBeenCalled()
    expect(prisma.producer.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { triunfoQuotesEnabled: false, sancorQuotesEnabled: true },
    })
  })
})
