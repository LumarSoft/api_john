import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma, ProposalStatus, Role } from 'generated/prisma/client'
import { Page, pageWindow, toPage } from '../common/pagination'
import { MailService } from '../mail/mail.service'
import { PrismaService } from '../prisma/prisma.service'
import { ListOwnerProposalsDto, PageQueryDto } from './dto/list-improvements.dto'
import { CreateProposalDto, UpdateProposalDto } from './dto/proposal.dto'

const PROPOSALS_PAGE_SIZE = 10

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

const OWNER_PROPOSAL_SELECT = { ...PROPOSAL_SELECT, producer: { select: { id: true, name: true } } } as const

const PROPOSAL_ORDER: Prisma.ImprovementProposalOrderByWithRelationInput[] = [{ createdAt: 'desc' }, { id: 'desc' }]

/** Still waiting for something from Lumar: neither done nor discarded. */
const OPEN_WHERE: Prisma.ImprovementProposalWhereInput = {
  status: { notIn: [ProposalStatus.DONE, ProposalStatus.DISCARDED] },
}

type ProposalRow = Prisma.ImprovementProposalGetPayload<{ select: typeof PROPOSAL_SELECT }>
type ProposalView = Omit<ProposalRow, 'authorId'> & { mine: boolean }
type OwnerProposalView = Prisma.ImprovementProposalGetPayload<{ select: typeof OWNER_PROPOSAL_SELECT }>

/** The owner's page plus the size of each list (ignoring the filter), for the chips. */
export interface OwnerProposalsPage extends Page<OwnerProposalView> {
  counts: { open: number; all: number }
}

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

  /**
   * The organization's board. With `page` it answers one page; without it, the
   * full array the panel read before paginating.
   */
  async listForOrganization(
    producerId: number,
    userId: number,
    query: PageQueryDto = {},
  ): Promise<ProposalView[] | Page<ProposalView>> {
    const where: Prisma.ImprovementProposalWhereInput = { producerId, deletedAt: null }
    const toView = ({ authorId, ...proposal }: ProposalRow): ProposalView => ({
      ...proposal,
      mine: authorId === userId,
    })
    if (query.page === undefined) {
      const proposals = await this.prisma.improvementProposal.findMany({
        where,
        orderBy: PROPOSAL_ORDER,
        select: PROPOSAL_SELECT,
      })
      return proposals.map(toView)
    }

    const { page, pageSize, skip, take } = pageWindow(query, PROPOSALS_PAGE_SIZE)
    const [total, proposals] = await Promise.all([
      this.prisma.improvementProposal.count({ where }),
      this.prisma.improvementProposal.findMany({ where, orderBy: PROPOSAL_ORDER, select: PROPOSAL_SELECT, skip, take }),
    ])
    return toPage(proposals.map(toView), total, page, pageSize)
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

  /**
   * Every organization's proposals. With `page` it answers one page of the open
   * ones (default) or of all; without it, the full array the panel read before paginating.
   */
  async listAll(query: ListOwnerProposalsDto = {}): Promise<OwnerProposalView[] | OwnerProposalsPage> {
    const base: Prisma.ImprovementProposalWhereInput = { deletedAt: null }
    if (query.page === undefined) {
      return this.prisma.improvementProposal.findMany({
        where: base,
        orderBy: PROPOSAL_ORDER,
        select: OWNER_PROPOSAL_SELECT,
      })
    }

    const { page, pageSize, skip, take } = pageWindow(query, PROPOSALS_PAGE_SIZE)
    const where = query.filter === 'all' ? base : { ...base, ...OPEN_WHERE }
    const [total, data, open, all] = await Promise.all([
      this.prisma.improvementProposal.count({ where }),
      this.prisma.improvementProposal.findMany({
        where,
        orderBy: PROPOSAL_ORDER,
        select: OWNER_PROPOSAL_SELECT,
        skip,
        take,
      }),
      this.prisma.improvementProposal.count({ where: { ...base, ...OPEN_WHERE } }),
      this.prisma.improvementProposal.count({ where: base }),
    ])
    return { ...toPage(data, total, page, pageSize), counts: { open, all } }
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
      select: OWNER_PROPOSAL_SELECT,
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
