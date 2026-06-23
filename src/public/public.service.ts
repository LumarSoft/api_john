import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../prisma/prisma.service'
import { formatSchedule, parseSchedule } from '../business-hours/schedule'
import { PRODUCT_CATALOG, type ProductCatalogItem } from './product-catalog'

export interface PublicProducerInfo {
  /** Formatted weekly hours; richer open-now info is at GET /public/hours. */
  attentionHours: string
}

/**
 * Read-only, unauthenticated data the public web (and the bot) consume so the
 * marketing copy and the attention window come from a single place. Never
 * exposes anything tenant-private — only catalog content and the public
 * attention window of the default producer.
 */
@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  getProducts(): ProductCatalogItem[] {
    return PRODUCT_CATALOG
  }

  async getProducerInfo(): Promise<PublicProducerInfo> {
    const slug = this.configService.get<string>('DEFAULT_PRODUCER_SLUG', 'john')
    const producer = await this.prisma.producer.findFirst({
      where: { slug, deletedAt: null },
      select: { businessHours: true },
    })
    return { attentionHours: formatSchedule(parseSchedule(producer?.businessHours ?? null)) }
  }
}
