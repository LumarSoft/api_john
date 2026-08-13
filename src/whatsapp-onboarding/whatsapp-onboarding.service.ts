import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { HttpService } from '@nestjs/axios'
import { firstValueFrom } from 'rxjs'
import { AxiosError } from 'axios'
import { PrismaService } from '../prisma/prisma.service'
import { decryptSecret, encryptSecret, resolveKey } from '../common/crypto/secret-crypto'
import { OnboardWhatsappDto } from './dto/onboard.dto'

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
  ) {}

  private get graphBase(): string {
    const version = this.config.get<string>('META_GRAPH_VERSION') ?? 'v25.0'
    return `https://graph.facebook.com/${version}`
  }

  private get encryptionKey() {
    return resolveKey(this.config.get<string>('WABA_TOKEN_ENCRYPTION_KEY'), 'WABA_TOKEN_ENCRYPTION_KEY')
  }

  async onboard(producerId: number, dto: OnboardWhatsappDto) {
    const existing = await this.prisma.phoneNumber.findUnique({
      where: { phoneNumberId: dto.phoneNumberId },
      select: { id: true, producerId: true, deletedAt: true },
    })
    if (existing && !existing.deletedAt) {
      throw new ConflictException(`El número ${dto.phoneNumberId} ya está conectado`)
    }

    // 1 — code → business token. The code dies 30s after the popup closes.
    const { accessToken, expiresAt } = await this.exchangeCode(dto.code)

    // 2 — subscribe THIS app to the customer's WABA. Without it: no webhooks.
    await this.subscribeApp(dto.wabaId, accessToken)

    // 3 — two-step PIN. On Coexistence the number arrives already registered and
    // Meta rejects /register, so a failure here must not undo the onboarding.
    let pinSet = false
    if (dto.pin) {
      pinSet = await this.trySetPin(dto.phoneNumberId, dto.pin, accessToken)
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

    const phoneNumber = existing
      ? await this.prisma.phoneNumber.update({
          where: { id: existing.id },
          data: {
            producerId,
            wabaAccountId: waba.id,
            number: dto.number ?? dto.phoneNumberId,
            isActive: true,
            deletedAt: null,
            responsibleProducerCodeId: dto.responsibleProducerCodeId ?? null,
          },
          select: { id: true },
        })
      : await this.prisma.phoneNumber.create({
          data: {
            phoneNumberId: dto.phoneNumberId,
            number: dto.number ?? dto.phoneNumberId,
            producerId,
            wabaAccountId: waba.id,
            responsibleProducerCodeId: dto.responsibleProducerCodeId ?? null,
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

    this.logger.log(
      `WABA ${dto.wabaId} conectada al productor ${producerId} · número ${dto.phoneNumberId} · ` +
        `coexistence=${dto.isCoexistence ?? false} · pin=${pinSet ? 'ok' : 'omitido'}`,
    )

    return {
      phoneNumberId: phoneNumber.id,
      wabaAccountId: waba.id,
      metaPhoneNumberId: dto.phoneNumberId,
      wabaId: dto.wabaId,
      subscribed: true,
      pinSet,
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

  /** Called from the webhook when Meta reports account_update → PARTNER_REMOVED. */
  async markDisconnected(wabaId: string, reason?: string) {
    await this.prisma.wabaAccount.updateMany({
      where: { wabaId },
      data: { disconnectedAt: new Date(), disconnectReason: reason?.slice(0, 64) ?? 'UNKNOWN' },
    })
    this.logger.error(`WABA ${wabaId} desconectada por Meta (${reason ?? 'sin motivo'})`)
  }

  // ── Graph API ──────────────────────────────────────────

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

/** Graph errors carry the useful part in body.error.message — surface that, not "Request failed". */
function describeGraphError(error: unknown): string {
  const axiosError = error as AxiosError<{ error?: { message?: string; code?: number } }>
  const metaMessage = axiosError?.response?.data?.error?.message
  if (metaMessage) return metaMessage
  if (axiosError?.message) return axiosError.message
  return 'error desconocido'
}
