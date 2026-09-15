import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { CoexistenceContactsDto, CoexistenceHistoryDto } from './dto/coexistence-sync.dto'

interface HistoryMessage {
  from?: string
  to?: string
  id?: string
  timestamp?: string
  type?: string
  text?: { body?: string }
  image?: { caption?: string }
  document?: { filename?: string; caption?: string }
  video?: { caption?: string }
  interactive?: {
    button_reply?: { title?: string }
    list_reply?: { title?: string }
  }
}

interface HistoryThread {
  id?: string
  messages?: HistoryMessage[]
}

interface HistoryChunk {
  threads?: HistoryThread[]
  errors?: unknown[]
}

interface SyncedContact {
  type?: string
  action?: string
  contact?: {
    phone_number?: string
    wa_id?: string
    full_name?: string
    first_name?: string
  }
  metadata?: { timestamp?: string }
}

@Injectable()
export class CoexistenceSyncService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persists Meta's one-time 180-day history backfill without opening sessions,
   * refreshing activity, or routing old messages through the bot. A conversation
   * created only by the import stays closed until that customer writes again.
   */
  async persistHistory(dto: CoexistenceHistoryDto) {
    const phoneNumber = await this.findPhoneNumber(dto.phoneNumberId)
    let threads = 0
    let receivedMessages = 0
    let insertedMessages = 0
    let skippedMessages = 0
    let errorChunks = 0

    for (const rawChunk of dto.chunks as HistoryChunk[]) {
      if (!rawChunk) continue
      if (rawChunk.errors?.length) {
        errorChunks += 1
        continue
      }

      for (const thread of rawChunk.threads ?? []) {
        const waId = normalizePhone(thread.id)
        if (!waId) {
          skippedMessages += thread.messages?.length ?? 0
          continue
        }

        threads += 1
        const conversation = await this.prisma.conversation.upsert({
          where: { waId_producerId: { waId, producerId: phoneNumber.producerId } },
          update: { phoneNumberId: dto.phoneNumberId },
          create: {
            waId,
            producerId: phoneNumber.producerId,
            phoneNumberId: dto.phoneNumberId,
            status: 'closed',
            // Keeps every imported message outside the active LLM session.
            sessionStartedAt: new Date(),
          },
          select: { id: true },
        })

        const messages = thread.messages ?? []
        receivedMessages += messages.length
        const rows = messages.flatMap(message => {
          if (!message.id) {
            skippedMessages += 1
            return []
          }
          return [
            {
              conversationId: conversation.id,
              role: normalizePhone(message.from) === waId ? 'user' : 'assistant',
              content: describeHistoryMessage(message),
              waMessageId: message.id,
              source: 'history',
              rawData: asJson(message),
              // Missing/invalid timestamps must not leak into the current session.
              createdAt: unixDate(message.timestamp) ?? new Date(0),
            },
          ]
        })

        if (rows.length) {
          const inserted = await this.prisma.message.createMany({ data: rows, skipDuplicates: true })
          insertedMessages += inserted.count
        }
      }
    }

    const syncedAt = errorChunks === 0 ? new Date() : null
    if (syncedAt) {
      await this.prisma.phoneNumber.update({
        where: { id: phoneNumber.id },
        data: { historyLastSyncedAt: syncedAt },
      })
    }

    return { threads, receivedMessages, insertedMessages, skippedMessages, errorChunks, syncedAt }
  }

  /** Upserts ongoing WhatsApp Business address-book changes idempotently. */
  async persistContacts(dto: CoexistenceContactsDto) {
    const phoneNumber = await this.findPhoneNumber(dto.phoneNumberId)
    let upsertedContacts = 0
    let removedContacts = 0
    let skippedContacts = 0

    for (const item of dto.contacts as SyncedContact[]) {
      if (!item || (item.type && item.type !== 'contact')) continue
      const contact = item.contact
      const phone = normalizePhone(contact?.phone_number ?? contact?.wa_id)
      if (!contact || !phone) {
        skippedContacts += 1
        continue
      }

      const action = item.action?.toLowerCase() ?? 'sync'
      const removed = action === 'remove' || action === 'delete'
      const sourceUpdatedAt = unixDate(item.metadata?.timestamp)
      const deletedAt = removed ? (sourceUpdatedAt ?? new Date()) : null

      await this.prisma.whatsAppContact.upsert({
        where: { phoneNumberId_phone: { phoneNumberId: phoneNumber.id, phone } },
        update: {
          waId: contact.wa_id ? normalizePhone(contact.wa_id) : undefined,
          fullName: contact.full_name,
          firstName: contact.first_name,
          lastAction: action,
          sourceUpdatedAt,
          rawData: asJson(item),
          deletedAt,
        },
        create: {
          phoneNumberId: phoneNumber.id,
          phone,
          waId: normalizePhone(contact.wa_id) || null,
          fullName: contact.full_name ?? null,
          firstName: contact.first_name ?? null,
          lastAction: action,
          sourceUpdatedAt,
          rawData: asJson(item),
          deletedAt,
        },
      })

      upsertedContacts += 1
      if (removed) removedContacts += 1
    }

    const syncedAt = new Date()
    await this.prisma.phoneNumber.update({
      where: { id: phoneNumber.id },
      data: { contactsLastSyncedAt: syncedAt },
    })

    return { upsertedContacts, removedContacts, skippedContacts, syncedAt }
  }

  private async findPhoneNumber(metaPhoneNumberId: string) {
    const phoneNumber = await this.prisma.phoneNumber.findUnique({
      where: { phoneNumberId: metaPhoneNumberId },
      select: { id: true, producerId: true },
    })
    if (!phoneNumber) throw new NotFoundException(`Phone number ${metaPhoneNumberId} is not registered`)
    return phoneNumber
  }
}

function normalizePhone(value: string | undefined): string {
  return value?.replace(/\D/g, '') ?? ''
}

function unixDate(value: string | undefined): Date | null {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  const date = new Date(seconds * 1000)
  return Number.isNaN(date.getTime()) ? null : date
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function describeHistoryMessage(message: HistoryMessage): string {
  switch (message.type) {
    case 'text':
      return message.text?.body?.trim() || '[mensaje de texto vacío]'
    case 'image':
      return message.image?.caption?.trim() || '[imagen]'
    case 'document':
      return message.document?.caption?.trim() || message.document?.filename?.trim() || '[documento]'
    case 'video':
      return message.video?.caption?.trim() || '[video]'
    case 'audio':
      return '[audio]'
    case 'sticker':
      return '[sticker]'
    case 'interactive':
      return (
        message.interactive?.button_reply?.title?.trim() ||
        message.interactive?.list_reply?.title?.trim() ||
        '[respuesta interactiva]'
      )
    default:
      return `[${message.type || 'mensaje'}]`
  }
}
