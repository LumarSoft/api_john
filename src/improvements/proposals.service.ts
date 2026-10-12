import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Role } from 'generated/prisma/client'
import { MailService } from '../mail/mail.service'
import { PrismaService } from '../prisma/prisma.service'
import { CreateProposalDto, UpdateProposalDto } from './dto/proposal.dto'

const PROPOSAL_SELECT = {
  id: true,
  title: true,
  description: true,
  status: true,
  response: true,
  respondedAt: true,
  createdAt: true,
  authorId: true,
  author: { select: { email: true } },
} as const

/**
 * Improvement proposals: the organization's users send them from "Mejoras",
 * everyone in the organization sees them (shared board), and Lumar (OWNER)
 * answers and moves them through the statuses. Each new one emails Lumar.
 */
@Injectable()
export class ProposalsService {
  private readonly logger = new Logger(ProposalsService.name)
  private readonly alertEmails: string[]

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    // Optional override; without it the alert goes to the platform OWNER accounts.
    this.alertEmails = (config.get<string>('PROPOSALS_ALERT_EMAIL') ?? '')
      .split(',')
      .map(email => email.trim())
      .filter(Boolean)
  }

  async listForOrganization(producerId: number, userId: number) {
    const proposals = await this.prisma.improvementProposal.findMany({
      where: { producerId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: PROPOSAL_SELECT,
    })
    return proposals.map(({ authorId, ...proposal }) => ({ ...proposal, mine: authorId === userId }))
  }

  async create(producerId: number, userId: number, dto: CreateProposalDto) {
    const { authorId, ...proposal } = await this.prisma.improvementProposal.create({
      data: { title: dto.title.trim(), description: dto.description.trim(), producerId, authorId: userId },
      select: { ...PROPOSAL_SELECT, producer: { select: { name: true } } },
    })
    // Best-effort: the proposal is saved whether or not the email goes out.
    void this.notifyOwner(proposal).catch(error =>
      this.logger.error(`Proposal #${proposal.id} alert failed: ${(error as Error).message}`),
    )
    const { producer: _producer, ...view } = proposal
    return { ...view, mine: authorId === userId }
  }

  // ── OWNER (Lumar) ─────────────────────────────────────

  async listAll() {
    return this.prisma.improvementProposal.findMany({
      where: { deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { ...PROPOSAL_SELECT, producer: { select: { id: true, name: true } } },
    })
  }

  /** Proposals nobody has looked at yet: the OWNER's sidebar badge. */
  async countNew(): Promise<{ count: number }> {
    const count = await this.prisma.improvementProposal.count({ where: { status: 'NEW', deletedAt: null } })
    return { count }
  }

  async update(id: number, dto: UpdateProposalDto) {
    const current = await this.prisma.improvementProposal.findFirst({
      where: { id, deletedAt: null },
      select: { response: true },
    })
    if (!current) throw new NotFoundException(`Proposal ${id} not found`)

    const response = dto.response === undefined ? undefined : dto.response.trim() || null
    const responseChanged = response !== undefined && response !== current.response

    return this.prisma.improvementProposal.update({
      where: { id },
      data: {
        status: dto.status,
        ...(responseChanged ? { response, respondedAt: response ? new Date() : null } : {}),
      },
      select: { ...PROPOSAL_SELECT, producer: { select: { id: true, name: true } } },
    })
  }

  private async notifyOwner(proposal: {
    id: number
    title: string
    description: string
    author: { email: string } | null
    producer: { name: string }
  }): Promise<void> {
    const to = this.alertEmails.length > 0 ? this.alertEmails : await this.ownerEmails()
    await this.mail.sendAlert({
      to,
      subject: `Nueva propuesta de mejora: ${proposal.title}`,
      text:
        `${proposal.author?.email ?? 'Un usuario'} (${proposal.producer.name}) propuso una mejora.\n\n` +
        `${proposal.title}\n\n${proposal.description}\n\n` +
        'Respondela desde Mejoras › Propuestas en el panel.',
    })
  }

  private async ownerEmails(): Promise<string[]> {
    const owners = await this.prisma.user.findMany({
      where: { role: Role.OWNER, deletedAt: null },
      select: { email: true },
    })
    return owners.map(owner => owner.email)
  }
}
