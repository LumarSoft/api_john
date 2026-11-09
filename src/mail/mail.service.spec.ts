import type { ConfigService } from '@nestjs/config'
import type { PrismaService } from '../prisma/prisma.service'
import { MailService } from './mail.service'

function setup(producer: { slug: string; botProfile: unknown } | null, number: { botProfile: unknown } | null = null) {
  const env: Record<string, string> = { ADVISOR_EMAIL: 'asesor@jpmg.test', DEFAULT_PRODUCER_SLUG: 'john' }
  const config = { get: (key: string) => env[key] } as unknown as ConfigService
  const prisma = {
    producer: { findFirst: jest.fn().mockResolvedValue(producer) },
    phoneNumber: { findFirst: jest.fn().mockResolvedValue(number) },
  }
  return new MailService(config, prisma as unknown as PrismaService)
}

describe('MailService claims recipient', () => {
  it("sends an organization's claims to its own e-mail", async () => {
    const mail = setup({ slug: 'norte', botProfile: { claimsEmail: 'siniestros@norte.test' } })
    await expect(mail.claimsRecipient(2)).resolves.toBe('siniestros@norte.test')
  })

  it('keeps JPMG on ADVISOR_EMAIL while it has no claims e-mail of its own', async () => {
    await expect(setup({ slug: 'john', botProfile: { orgShortName: 'JPMG' } }).claimsRecipient(1)).resolves.toBe(
      'asesor@jpmg.test',
    )
  })

  it("sends a claim to the e-mail of the branch's number when it has its own", async () => {
    const mail = setup(
      { slug: 'norte', botProfile: { claimsEmail: 'siniestros@norte.test' } },
      { botProfile: { claimsEmail: 'rafaela@norte.test' } },
    )
    await expect(mail.claimsRecipient(2, 'P2')).resolves.toBe('rafaela@norte.test')
    await expect(
      setup(
        { slug: 'norte', botProfile: { claimsEmail: 'siniestros@norte.test' } },
        { botProfile: null },
      ).claimsRecipient(2, 'P2'),
    ).resolves.toBe('siniestros@norte.test')
  })

  it("never sends another organization's claims to JPMG's advisor", async () => {
    await expect(setup({ slug: 'norte', botProfile: null }).claimsRecipient(2)).resolves.toBeNull()
    await expect(setup(null).claimsRecipient(9)).resolves.toBeNull()
  })
})
