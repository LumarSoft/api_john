import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ScopeService, type ScopeUser } from '../common/scope/scope.service'
import { readCommercialPricing } from '../usage/commercial-pricing'
import { initialPlanId } from '../usage/initial-plan'
import { decryptSecret, encryptSecret, resolveKey } from '../common/crypto/secret-crypto'
import { OnboardWhatsappDto } from './dto/onboard.dto'
import { describeGraphError } from './graph-errors'
import { WhatsappPortfolioService } from './whatsapp-portfolio.service'

interface MetaPhoneNumberStatus {
  id?: string
  display_phone_number?: string
  is_on_biz_app?: boolean
  platform_type?: string
}

const COEXISTENCE_STATUS_ATTEMPTS = 4
const COEXISTENCE_STATUS_RETRY_MS = 750

/** SuperAdmin and OWNER connect any number of the organization; an admin only their codes' numbers. */
const isOrganizationWide = (user: ScopeUser) => user.role === Role.SUPERADMIN || user.role === Role.OWNER

/**
 * Turns the result of an Embedded Signup session into a working number.
 *
 * Meta hands the browser three things — a short-lived `code`, a `waba_id` and a
 * `phone_number_id` — and everything else is server-to-server:
 *
 *   1. exchange the code for the customer's BUSINESS TOKEN
 *   2. POST /{waba-id}/subscribed_apps   ← the step that makes webhooks flow
 *   3. set the two-step PIN (best effort on Coexistence, see below)
 *   4. persist WabaAccount + PhoneNumber so the bot can resolve the number
 *
 * Step 2 is the one that silently breaks everything when it is missing: the
 * onboarding looks successful, the number appears in WhatsApp Manager, and not a
 * single message ever reaches the webhook. If a connected number goes quiet,
 * check `subscribed_apps` before anything else.
 */
@Injectable()
export class WhatsappOnboardingService {
  private readonly logger = new Logger(WhatsappOnboardingService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly http: HttpService,
    private readonly scope: ScopeService,
    private readonly portfolio: WhatsappPortfolioService,
  ) {}

  private get graphBase(): string {
    const version = this.config.get<string>('META_GRAPH_VERSION') ?? 'v25.0'
    return `https://graph.facebook.com/${version}`
  }

  private get encryptionKey() {
    return resolveKey(this.config.get<string>('WABA_TOKEN_ENCRYPTION_KEY'), 'WABA_TOKEN_ENCRYPTION_KEY')
  }

  async onboard(user: ScopeUser, dto: OnboardWhatsappDto) {
    const { producerId } = user
    // 0 — billing codes, checked before the code is spent.
    const billing = await this.resolveBilling(user, dto)

    // 1 — code → business token. The code dies 30s after the popup closes.
    const { accessToken, expiresAt } = await this.exchangeCode(dto.code)

    // Coexistence's session event is allowed to omit phone_number_id. Resolve it
    // server-side with the fresh customer token instead of making the browser
    // fail after the number has already been connected in WhatsApp.
    const phoneNumberId = await this.resolvePhoneNumberId(
      dto.wabaId,
      dto.phoneNumberId,
      dto.isCoexistence ?? false,
      accessToken,
    )
    const coexistenceStatus = dto.isCoexistence
      ? await this.waitForCoexistenceConfirmation(phoneNumberId, accessToken)
      : null

    // `featureType=whatsapp_business_app_onboarding` is a request, not a
    // guarantee: Meta can still finish the standard Cloud API flow. Graph is
    // authoritative. Do not subscribe or persist a false Coexistence result.
    if (dto.isCoexistence && !coexistenceStatus?.verified) {
      throw new BadRequestException(
        'Meta registró el número únicamente en Cloud API y no confirmó Coexistence ' +
          '(is_on_biz_app=false). El número no fue guardado. Usá un número activo en WhatsApp Business, ' +
          'elegí conectar la aplicación existente y completá la confirmación desde el teléfono.',
      )
    }

    const displayPhoneNumber = dto.number ?? coexistenceStatus?.displayPhoneNumber ?? undefined
    const existing = await this.findNumberToReconnect(
      producerId,
      dto.wabaId,
      phoneNumberId,
      dto.isCoexistence ?? false,
      displayPhoneNumber,
    )
    // An admin reconnects only a number billed to one of their codes, never another office's.
    if (existing && billing.ownCodes && !billing.ownCodes.includes(existing.responsibleProducerCodeId ?? -1)) {
      throw new ForbiddenException(
        'Este número está a cargo de otro código de productor. Pedile al SuperAdmin que lo reconecte.',
      )
    }

    // 2 — subscribe THIS app to the customer's WABA. Without it: no webhooks.
    await this.subscribeApp(dto.wabaId, accessToken)

    // 3 — two-step PIN. On Coexistence the number arrives already registered and
    // Meta rejects /register, so a failure here must not undo the onboarding.
    let pinSet = false
    if (dto.pin) {
      pinSet = await this.trySetPin(phoneNumberId, dto.pin, accessToken)
    }

    // 4 — persist. The token lives in the DB precisely because it is per-WABA:
    // with two tenants a single WHATSAPP_TOKEN in the environment cannot work.
    const waba = await this.prisma.wabaAccount.upsert({
      where: { wabaId: dto.wabaId },
      create: {
        wabaId: dto.wabaId,
        producerId,
        accessToken: encryptSecret(accessToken, this.encryptionKey),
        tokenExpiresAt: expiresAt,
        isCoexistence: dto.isCoexistence ?? false,
      },
      update: {
        producerId,
        accessToken: encryptSecret(accessToken, this.encryptionKey),
        tokenExpiresAt: expiresAt,
        isCoexistence: dto.isCoexistence ?? false,
        disconnectedAt: null,
        disconnectReason: null,
      },
    })

    // Which business portfolio owns the account, for the panel. Read-only; a failure does not stop the onboarding.
    await this.portfolio.refreshWith(waba.id, dto.wabaId, accessToken)

    const phoneNumber = existing
      ? await this.reconnectNumber(existing, {
          phoneNumberId,
          producerId,
          wabaAccountId: waba.id,
          number: displayPhoneNumber,
          responsibleProducerCodeId: dto.responsibleProducerCodeId,
        })
      : await this.prisma.phoneNumber.create({
          data: {
            phoneNumberId,
            number: displayPhoneNumber ?? phoneNumberId,
            producerId,
            wabaAccountId: waba.id,
            responsibleProducerCodeId: billing.responsibleProducerCodeId ?? null,
            // A new account's number starts on the trial plan.
            planId: await initialPlanId(this.prisma, readCommercialPricing(this.config), producerId),
          },
          select: { id: true },
        })

    if (dto.servedCodeIds?.length) {
      await this.prisma.phoneNumberProducerCode.createMany({
        data: dto.servedCodeIds.map(producerCodeId => ({
          phoneNumberId: phoneNumber.id,
          producerCodeId,
        })),
        skipDuplicates: true,
      })
    }

    // These are one-shot calls and Meta gives us only 24 hours after onboarding.
    // Request history first (the user-visible data), then contacts. Failures are
    // surfaced in the response without undoing an otherwise valid connection.
    const historySyncRequested = dto.isCoexistence
      ? await this.requestAppDataSync(phoneNumberId, 'history', accessToken)
      : false
    const contactsSyncRequested = dto.isCoexistence
      ? await this.requestAppDataSync(phoneNumberId, 'smb_app_state_sync', accessToken)
      : false

    this.logger.log(
      `WABA ${dto.wabaId} ${existing ? 'reconectada' : 'conectada'} al productor ${producerId} · ` +
        `número ${phoneNumberId} · coexistence=${dto.isCoexistence ?? false} · pin=${pinSet ? 'ok' : 'omitido'}`,
    )

    return {
      phoneNumberId: phoneNumber.id,
      reconnected: existing != null,
      wabaAccountId: waba.id,
      metaPhoneNumberId: phoneNumberId,
      wabaId: dto.wabaId,
      subscribed: true,
      pinSet,
      historySyncRequested,
      contactsSyncRequested,
      coexistenceVerified: coexistenceStatus?.verified ?? null,
      isOnBizApp: coexistenceStatus?.isOnBizApp ?? null,
      platformType: coexistenceStatus?.platformType ?? null,
      tokenExpiresAt: expiresAt,
    }
  }

  /**
   * WABAs whose token expires within `days`. Meant for a daily cron: a token
   * that lapses takes the client's number down silently.
   */
  async findTokensExpiringSoon(days = 14) {
    const threshold = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    return this.prisma.wabaAccount.findMany({
      where: { disconnectedAt: null, tokenExpiresAt: { not: null, lte: threshold } },
      select: { id: true, wabaId: true, producerId: true, tokenExpiresAt: true },
    })
  }

  /** Business token for a connected number, decrypted. Used by the bot context. */
  async getAccessTokenForPhoneNumber(metaPhoneNumberId: string): Promise<string | null> {
    const row = await this.prisma.phoneNumber.findUnique({
      where: { phoneNumberId: metaPhoneNumberId },
      select: { wabaAccount: { select: { accessToken: true, disconnectedAt: true } } },
    })
    if (!row?.wabaAccount || row.wabaAccount.disconnectedAt) return null
    return decryptSecret(row.wabaAccount.accessToken, this.encryptionKey)
  }

  async retryAppDataSync(user: ScopeUser, metaPhoneNumberId: string) {
    await this.assertSeesNumber(user, metaPhoneNumberId)
    const accessToken = await this.getAccessTokenForPhoneNumber(metaPhoneNumberId)
    if (!accessToken) {
      throw new BadRequestException(`El número ${metaPhoneNumberId} no tiene un WABA activo`)
    }
    return {
      historySyncRequested: await this.requestAppDataSync(metaPhoneNumberId, 'history', accessToken),
      contactsSyncRequested: await this.requestAppDataSync(metaPhoneNumberId, 'smb_app_state_sync', accessToken),
    }
  }

  /** Read-only production check used after Embedded Signup and during cutover. */
  async getConnectionStatus(user: ScopeUser, metaPhoneNumberId: string) {
    await this.assertSeesNumber(user, metaPhoneNumberId)
    const accessToken = await this.getAccessTokenForPhoneNumber(metaPhoneNumberId)
    if (!accessToken) {
      throw new BadRequestException(`El número ${metaPhoneNumberId} no tiene un WABA activo`)
    }
    const [meta, local, persistedHistoryMessages, persistedContacts] = await Promise.all([
      this.inspectCoexistenceStatus(metaPhoneNumberId, accessToken),
      this.prisma.phoneNumber.findUnique({
        where: { phoneNumberId: metaPhoneNumberId },
        select: { historyLastSyncedAt: true, contactsLastSyncedAt: true },
      }),
      this.prisma.message.count({
        where: { source: 'history', conversation: { phoneNumberId: metaPhoneNumberId, deletedAt: null } },
      }),
      this.prisma.whatsAppContact.count({
        where: { phoneNumber: { phoneNumberId: metaPhoneNumberId }, deletedAt: null },
      }),
    ])

    return {
      ...meta,
      historyLastSyncedAt: local?.historyLastSyncedAt ?? null,
      contactsLastSyncedAt: local?.contactsLastSyncedAt ?? null,
      persistedHistoryMessages,
      persistedContacts,
    }
  }

  /**
   * The codes a new number is billed to and serves. The SuperAdmin may use any
   * of the organization's; an admin only their own, and their number is always
   * billed to one of them (their only code when the panel sends none).
   * `ownCodes` is null when the caller may reconnect any number.
   */
  private async resolveBilling(
    user: ScopeUser,
    dto: OnboardWhatsappDto,
  ): Promise<{ ownCodes: number[] | null; responsibleProducerCodeId?: number }> {
    const accessible = await this.scope.resolveAccessibleProducerCodeIds(user)
    const requested = [dto.responsibleProducerCodeId, ...(dto.servedCodeIds ?? [])].filter(
      (id): id is number => id != null,
    )
    if (requested.some(id => !accessible.includes(id))) {
      throw new ForbiddenException('Solo podés asignar el número a códigos de productor a tu cargo')
    }
    if (isOrganizationWide(user)) return { ownCodes: null, responsibleProducerCodeId: dto.responsibleProducerCodeId }

    const responsibleProducerCodeId =
      dto.responsibleProducerCodeId ?? (accessible.length === 1 ? accessible[0] : undefined)
    if (responsibleProducerCodeId == null) {
      throw new BadRequestException('Elegí el código de productor responsable del número')
    }
    return { ownCodes: accessible, responsibleProducerCodeId }
  }

  /**
   * The OWNER checks any number, the SuperAdmin those of its organization and an
   * admin those billed to one of their codes. Anything else is "not found".
   */
  private async assertSeesNumber(user: ScopeUser, metaPhoneNumberId: string): Promise<void> {
    if (user.role === Role.OWNER) return
    const phone = await this.prisma.phoneNumber.findFirst({
      where: { phoneNumberId: metaPhoneNumberId, producerId: user.producerId, deletedAt: null },
      select: { responsibleProducerCodeId: true },
    })
    const sees =
      phone != null &&
      (isOrganizationWide(user) ||
        (phone.responsibleProducerCodeId != null &&
          (await this.scope.canAccessCode(user, phone.responsibleProducerCodeId))))
    if (!sees) throw new NotFoundException(`El número ${metaPhoneNumberId} no está entre tus números`)
  }

  /**
   * The PhoneNumber row a (re)connection reuses, so a Coexistence drop does not
   * cost the month's usage, the budget or the producer codes:
   *
   *   1. the row with this Meta id, deleted or not — the usual reconnection
   *   2. on Coexistence, when Meta hands out a NEW phone_number_id: the latest
   *      row of the same WABA, or of any WABA with the same display number,
   *      provided it is no longer live (deleted, or its WABA disconnected)
   *
   * A live row with this Meta id owned by another organization is a conflict.
   */
  private async findNumberToReconnect(
    producerId: number,
    wabaId: string,
    phoneNumberId: string,
    isCoexistence: boolean,
    displayPhoneNumber: string | undefined,
  ): Promise<{ id: number; phoneNumberId: string; responsibleProducerCodeId: number | null } | null> {
    const sameId = await this.prisma.phoneNumber.findUnique({
      where: { phoneNumberId },
      select: { id: true, producerId: true, deletedAt: true, phoneNumberId: true, responsibleProducerCodeId: true },
    })
    if (sameId) {
      if (!sameId.deletedAt && sameId.producerId !== producerId) {
        throw new ConflictException(`El número ${phoneNumberId} ya está conectado a otra organización`)
      }
      return sameId
    }
    if (!isCoexistence) return null

    const rows = await this.prisma.phoneNumber.findMany({
      where: { producerId },
      select: {
        id: true,
        phoneNumberId: true,
        number: true,
        deletedAt: true,
        responsibleProducerCodeId: true,
        wabaAccount: { select: { wabaId: true, disconnectedAt: true } },
      },
      orderBy: { id: 'desc' },
    })
    const replaceable = rows.filter(row => row.deletedAt != null || row.wabaAccount?.disconnectedAt != null)
    return (
      replaceable.find(
        row => row.wabaAccount?.wabaId === wabaId && displayNumberMatches(row, displayPhoneNumber, true),
      ) ??
      replaceable.find(row => displayNumberMatches(row, displayPhoneNumber, false)) ??
      null
    )
  }

  /**
   * Brings a previous row back to life on the new connection. When Meta issued
   * a new phone_number_id the chats move with it, so the inbox and the bot keep
   * each customer's history instead of starting a second conversation.
   */
  private async reconnectNumber(
    row: { id: number; phoneNumberId: string },
    data: {
      phoneNumberId: string
      producerId: number
      wabaAccountId: number
      number?: string
      responsibleProducerCodeId?: number
    },
  ): Promise<{ id: number }> {
    const update = this.prisma.phoneNumber.update({
      where: { id: row.id },
      data: {
        phoneNumberId: data.phoneNumberId,
        producerId: data.producerId,
        wabaAccountId: data.wabaAccountId,
        isActive: true,
        deletedAt: null,
        ...(data.number ? { number: data.number } : {}),
        // The panel's connect button sends no code: keep the one already set.
        ...(data.responsibleProducerCodeId !== undefined
          ? { responsibleProducerCodeId: data.responsibleProducerCodeId }
          : {}),
      },
      select: { id: true },
    })
    if (row.phoneNumberId === data.phoneNumberId) return update

    const [phone] = await this.prisma.$transaction([
      update,
      this.prisma.conversation.updateMany({
        where: { phoneNumberId: row.phoneNumberId },
        data: { phoneNumberId: data.phoneNumberId },
      }),
    ])
    this.logger.warn(
      `Meta asignó un phone_number_id nuevo (${row.phoneNumberId} → ${data.phoneNumberId}); ` +
        `se reutilizó el número #${row.id} con sus chats y su consumo`,
    )
    return phone
  }

  // ── Graph API ──────────────────────────────────────────

  private async resolvePhoneNumberId(
    wabaId: string,
    requestedId: string | undefined,
    isCoexistence: boolean,
    accessToken: string,
  ): Promise<string> {
    if (!isCoexistence) {
      if (!requestedId) throw new BadRequestException('Meta no devolvió phone_number_id')
      return requestedId
    }

    try {
      const { data } = await firstValueFrom(
        this.http.get<{
          data?: Array<{
            id: string
            display_phone_number?: string
            is_on_biz_app?: boolean
            platform_type?: string
          }>
        }>(`${this.graphBase}/${wabaId}/phone_numbers`, {
          params: { fields: 'id,display_phone_number,is_on_biz_app,platform_type' },
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 15_000,
        }),
      )

      const numbers = data?.data ?? []
      if (requestedId && numbers.some(number => number.id === requestedId)) return requestedId

      const coexistenceNumbers = numbers.filter(
        number => number.is_on_biz_app === true && number.platform_type === 'CLOUD_API',
      )
      if (coexistenceNumbers.length === 1) return coexistenceNumbers[0].id
      if (numbers.length === 1) return numbers[0].id

      throw new Error(
        numbers.length === 0
          ? 'la WABA no contiene números'
          : 'la WABA contiene más de un número y Meta no indicó cuál se conectó',
      )
    } catch (error) {
      // Older session payloads include the id directly. If it was supplied, it
      // remains the best source even if the optional discovery query is denied.
      if (requestedId) return requestedId
      throw new BadRequestException(
        `No se pudo resolver el número conectado dentro de la WABA ${wabaId}: ${describeGraphError(error)}`,
      )
    }
  }

  private async exchangeCode(code: string): Promise<{ accessToken: string; expiresAt: Date | null }> {
    const appId = this.config.getOrThrow<string>('META_APP_ID')
    const appSecret = this.config.getOrThrow<string>('META_APP_SECRET')

    try {
      const { data } = await firstValueFrom(
        this.http.get<{ access_token: string; expires_in?: number }>(`${this.graphBase}/oauth/access_token`, {
          params: { client_id: appId, client_secret: appSecret, code },
          timeout: 15_000,
        }),
      )
      if (!data?.access_token) throw new Error('la respuesta no trajo access_token')
      // La plantilla estándar emite tokens de 60 días. Guardamos el vencimiento
      // para poder avisar antes de que el número se quede mudo.
      const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null
      return { accessToken: data.access_token, expiresAt }
    } catch (error) {
      throw new BadRequestException(
        `No se pudo canjear el código de Embedded Signup: ${describeGraphError(error)}. ` +
          'El código vence a los 30 segundos — si tardaste, repetí el onboarding.',
      )
    }
  }

  private async subscribeApp(wabaId: string, accessToken: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(
          `${this.graphBase}/${wabaId}/subscribed_apps`,
          {},
          { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15_000 },
        ),
      )
    } catch (error) {
      throw new BadRequestException(
        `El número quedó conectado en Meta pero la app no pudo suscribirse a la WABA ${wabaId}: ` +
          `${describeGraphError(error)}. Sin esto no llega ningún mensaje al webhook.`,
      )
    }
  }

  private async requestAppDataSync(
    phoneNumberId: string,
    syncType: 'history' | 'smb_app_state_sync',
    accessToken: string,
  ): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.post(
          `${this.graphBase}/${phoneNumberId}/smb_app_data`,
          { messaging_product: 'whatsapp', sync_type: syncType },
          { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15_000 },
        ),
      )
      return true
    } catch (error) {
      this.logger.error(`No se pudo solicitar sync ${syncType} para ${phoneNumberId}: ${describeGraphError(error)}`)
      return false
    }
  }

  private async inspectCoexistenceStatus(phoneNumberId: string, accessToken: string) {
    try {
      const { data } = await firstValueFrom(
        this.http.get<MetaPhoneNumberStatus>(`${this.graphBase}/${phoneNumberId}`, {
          params: { fields: 'id,display_phone_number,is_on_biz_app,platform_type' },
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 15_000,
        }),
      )
      const isOnBizApp = data?.is_on_biz_app === true
      const platformType = data?.platform_type ?? null
      return {
        metaPhoneNumberId: phoneNumberId,
        displayPhoneNumber: data?.display_phone_number ?? null,
        verified: isOnBizApp && platformType === 'CLOUD_API',
        isOnBizApp,
        platformType,
      }
    } catch (error) {
      this.logger.error(`No se pudo verificar Coexistence para ${phoneNumberId}: ${describeGraphError(error)}`)
      return {
        metaPhoneNumberId: phoneNumberId,
        displayPhoneNumber: null,
        verified: false,
        isOnBizApp: null,
        platformType: null,
      }
    }
  }

  /** Graph may take a few seconds to expose the Business-app flag after signup. */
  private async waitForCoexistenceConfirmation(phoneNumberId: string, accessToken: string) {
    let status = await this.inspectCoexistenceStatus(phoneNumberId, accessToken)
    for (let attempt = 1; !status.verified && attempt < COEXISTENCE_STATUS_ATTEMPTS; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, COEXISTENCE_STATUS_RETRY_MS))
      status = await this.inspectCoexistenceStatus(phoneNumberId, accessToken)
    }
    return status
  }

  private async trySetPin(phoneNumberId: string, pin: string, accessToken: string): Promise<boolean> {
    try {
      await firstValueFrom(
        this.http.post(
          `${this.graphBase}/${phoneNumberId}/register`,
          { messaging_product: 'whatsapp', pin },
          { headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15_000 },
        ),
      )
      return true
    } catch (error) {
      // Expected on Coexistence: the number is already registered through the app.
      this.logger.warn(`No se pudo fijar el PIN de ${phoneNumberId}: ${describeGraphError(error)}`)
      return false
    }
  }
}

/**
 * Whether a stored row is the same line as the number Meta just connected.
 * Older rows store the Meta id as their "number" (the display number was never
 * sent), so an unknown side only matches when `allowUnknown` is set — used
 * inside the same WABA, where a Coexistence account holds a single number.
 */
function displayNumberMatches(
  row: { number: string; phoneNumberId: string },
  displayPhoneNumber: string | undefined,
  allowUnknown: boolean,
): boolean {
  const digits = (value: string) => value.replace(/\D/g, '')
  const rowKnown = row.number !== row.phoneNumberId && digits(row.number).length >= 8
  if (!displayPhoneNumber || !rowKnown) return allowUnknown
  return digits(row.number) === digits(displayPhoneNumber)
}
