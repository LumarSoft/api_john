import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import * as bcrypt from 'bcrypt'
import { ConfigService } from '@nestjs/config'
import { RiskType } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import {
  TriunfoService,
  type TriunfoNovedad,
  type TriunfoCuotaDato,
  type TriunfoVehiculoDato,
} from '../triunfo/triunfo.service'

// ─── Helpers ─────────────────────────────────────────────

/**
 * Determine RiskType from vehicle data and Triunfo article code.
 *
 * Vehicle policies: always have SDTVehiculoDatos — classify by Tipo field.
 *   - MOTO / MOTOCICLETA / MOTOS * CC  → moto
 *   - AUTOMOVIL / PICK UP / CAMION / TRAILER / OMNIBUS / ACOPLADO → auto
 *
 * Non-vehicle policies: classify by Triunfo article code.
 *   - 197, 128, 124, 195 → life  (sepelio, accidentes personales)
 *   - 267, 264           → home  (hogar — incendio + robo + contenido)
 *   - 170, 802           → commercial (comercio / edificio / RC)
 *   - 657                → other (bicicleta — robo, incendio, RC)
 *   - rest               → other
 */
function resolveRiskType(vehiculoDatos: TriunfoVehiculoDato | null, articulo: number | string): RiskType {
  if (vehiculoDatos) {
    const tipo = (vehiculoDatos.Tipo ?? '').toUpperCase()
    if (tipo.includes('MOTO') || tipo === 'MOTOCICLETA') return RiskType.moto
    return RiskType.auto
  }
  const code = Number(articulo)
  if (code === 197 || code === 128 || code === 124 || code === 195) return RiskType.life
  if (code === 267 || code === 264) return RiskType.home
  if (code === 170 || code === 802) return RiskType.commercial
  return RiskType.other
}

// "BENITEZ EVELYN ELIZABETH" → { firstName: "EVELYN ELIZABETH", lastName: "BENITEZ" }
// Triunfo sends APELLIDO NOMBRE in all-caps. Falls back gracefully.
function parseName(raw: string | null | undefined): { firstName: string; lastName: string } {
  const str = (raw ?? '').trim()
  if (!str || /^\d+$/.test(str)) return { firstName: '—', lastName: '—' }
  const parts = str.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return { firstName: parts[0], lastName: '—' }
  // First token = apellido, rest = nombre (Triunfo convention)
  return { firstName: parts.slice(1).join(' '), lastName: parts[0] }
}

function isoDate(str: string | null | undefined): Date | null {
  if (!str || str === '0000-00-00') return null
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

// Format a Date as YYYY-MM-DD using local time (avoids UTC offset issues at night)
function localISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Human-readable elapsed time, e.g. "1m 23s" or "12.3s".
function formatDuration(ms: number): string {
  const totalSeconds = ms / 1000
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  return `${minutes}m ${seconds}s`
}

// Build date range: Triunfo limits to ~6 months lookback
function buildDateRange(): { fechaDesde: string; fechaHasta: string } {
  const hasta = new Date()
  const desde = new Date()
  desde.setMonth(desde.getMonth() - 6)
  return {
    fechaDesde: localISODate(desde),
    fechaHasta: localISODate(hasta),
  }
}

// Map Triunfo cuota Estado to our status values
function mapCuotaStatus(estado: string, dueDate: Date | null): string {
  const upper = (estado ?? '').toUpperCase()
  if (upper === 'PAGADA' || upper === 'COBRADA') return 'paid'
  if (upper === 'RECHAZADA' || upper === 'RECHAZADO' || upper === 'DEBITO_RECHAZADO') return 'rejected'
  if (dueDate && dueDate < new Date()) return 'overdue'
  return 'pending'
}

// ─── Service ─────────────────────────────────────────────

export interface CarteraSyncResult {
  codesProcessed: number
  synced: number
  skipped: number
  /** Total wall-clock time of the run in milliseconds. */
  elapsedMs?: number
  /** True when a run was skipped because another was already in flight. */
  skippedRun?: boolean
}

@Injectable()
export class CarteraSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CarteraSyncService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly triunfo: TriunfoService,
    private readonly config: ConfigService,
  ) {}

  // Runs once when the API boots — non-blocking
  onApplicationBootstrap(): void {
    if (this.config.get<string>('TRIUNFO_CARTERA_SYNC_ENABLED') !== 'true') {
      this.logger.log('Cartera sync disabled (TRIUNFO_CARTERA_SYNC_ENABLED != true)')
      return
    }
    void this.runGuarded().catch(err => this.logger.error(`Cartera sync failed: ${err?.message ?? err}`))
  }

  // Keeps policies/cuotas fresh in production. Runs every 12h, gated by the same
  // flag as the bootstrap run. Guarded against overlap so a long sync (many
  // codes, one Triunfo call each) never stacks on top of the previous one.
  private syncing = false

  @Cron(CronExpression.EVERY_12_HOURS)
  async scheduledSync(): Promise<CarteraSyncResult | undefined> {
    if (this.config.get<string>('TRIUNFO_CARTERA_SYNC_ENABLED') !== 'true') return
    return this.runGuarded()
  }

  /** Runs the sync unless one is already in flight (overlap guard). */
  async runGuarded(): Promise<CarteraSyncResult> {
    if (this.syncing) {
      this.logger.warn('Cartera sync already running — skipping this run')
      return { codesProcessed: 0, synced: 0, skipped: 0, skippedRun: true }
    }
    this.syncing = true
    try {
      return await this.syncCartera()
    } finally {
      this.syncing = false
    }
  }

  async syncCartera(): Promise<CarteraSyncResult> {
    const startedAt = Date.now()
    const { fechaDesde, fechaHasta } = buildDateRange()
    this.logger.log(`Starting cartera sync (${fechaDesde} → ${fechaHasta})`)

    // Iterate every active producer code of every active org. Triunfo returns
    // each code's own cartera when we pass its `code` (same master credential,
    // varying only Codigo — confirmed in Postman). So each client/poliza is
    // attributed to the producerCodeId of the query it came from.
    const producers = await this.prisma.producer.findMany({
      where: { isActive: true, deletedAt: null },
      select: {
        id: true,
        masterCode: true,
        producerCodes: {
          where: { isActive: true, deletedAt: null },
          select: { id: true, code: true },
        },
      },
    })

    let synced = 0
    let skipped = 0
    let codesProcessed = 0

    for (const producer of producers) {
      // Defensive fallback: if no ProducerCode rows are loaded yet (migration/seed
      // not applied), fall back to a single query with the env master code so the
      // sync isn't silently empty. Attributes to null (back-fill to master later).
      const targets =
        producer.producerCodes.length > 0
          ? producer.producerCodes.map(pc => ({ id: pc.id as number | null, code: pc.code }))
          : [{ id: null as number | null, code: producer.masterCode ?? undefined }]

      if (producer.producerCodes.length === 0) {
        this.logger.warn(
          `Producer ${producer.id} has no ProducerCode rows — run the migration + seed. Using env/master code fallback.`,
        )
      }

      for (const target of targets) {
        codesProcessed++
        let novedades: TriunfoNovedad[] = []
        try {
          // code undefined → TriunfoService defaults to TRIUNFO_PRODUCTOR (env master).
          novedades = await this.triunfo.getNovedadesCartera(fechaDesde, fechaHasta, target.code)
          this.logger.log(`Code ${target.code ?? '(env master)'}: ${novedades.length} novedades`)
        } catch (err) {
          this.logger.warn(
            `Code ${target.code ?? '(env master)'}: NovedadesCartera failed — ${err instanceof Error ? err.message : err}`,
          )
          continue
        }

        for (const novedad of novedades) {
          try {
            await this.syncNovedad(novedad, producer.id, target.id)
            synced++
          } catch (err) {
            skipped++
            this.logger.warn(
              `Skipped certificado ${novedad.Certificado} (code ${target.code ?? 'env'}) — ${err instanceof Error ? err.message : err}`,
            )
          }
        }
      }
    }

    const elapsedMs = Date.now() - startedAt
    const elapsed = formatDuration(elapsedMs)
    this.logger.log(
      `Cartera sync complete — ${codesProcessed} codes, ${synced} upserted, ${skipped} skipped in ${elapsed} (${elapsedMs} ms)`,
    )
    return { codesProcessed, synced, skipped, elapsedMs }
  }

  private async syncNovedad(novedad: TriunfoNovedad, producerId: number, producerCodeId: number | null): Promise<void> {
    // Triunfo sends DocNumero "0" for entities identified by CUIT (e.g. SRLs).
    // Fall back to the CUIT so two different companies aren't merged into one
    // client (and so their policies are never dropped). Skip only if neither
    // a usable DNI nor CUIT is present.
    const docNumero = String(novedad.DocNumero ?? '').trim()
    const cuit = String(novedad.CUIT ?? '').trim()
    const dni = docNumero && docNumero !== '0' ? docNumero : cuit && cuit !== '0' ? cuit : ''
    const certificado = String(novedad.Certificado).trim()

    if (!dni || !certificado) {
      this.logger.warn(`Skipped certificado ${novedad.Certificado} — no usable DocNumero/CUIT`)
      return
    }

    // ── Extract fields with fallbacks ─────────────────────
    // A company (identified by CUIT, no real DocNumero) keeps its full razón
    // social in firstName instead of being split into apellido/nombre.
    const isCompany = !(docNumero && docNumero !== '0')
    const nombre = (novedad.RazonSocial ?? novedad.Asegurado ?? '').trim()
    const { firstName, lastName } = isCompany ? { firstName: nombre || '—', lastName: '' } : parseName(nombre)

    const realEmail = novedad.Email?.trim() || null
    const phone = novedad.Telefono?.trim() || null
    const city = novedad.Localidad?.trim() || null

    const vigDesde = isoDate(novedad.VigenciaDesde ?? novedad.FechaVigDesde)
    const vigHasta = isoDate(novedad.VigenciaHasta ?? novedad.FechaVigHasta)
    const status = novedad.EstadoPoliza ?? novedad.Estado ?? ''
    const premio = novedad.DetallePremio?.Premio ?? novedad.Premio ?? null
    const paymentMethod = novedad.MedioPagoDescripcion ?? null
    const suplemento = novedad.Suplemento ?? 0

    // Extract vehicle data first — presence determines riskType
    const vehiculoDatos: TriunfoVehiculoDato | null =
      Array.isArray(novedad.SDTVehiculoDatos) && novedad.SDTVehiculoDatos.length > 0
        ? novedad.SDTVehiculoDatos[0]
        : null

    const riskType = resolveRiskType(vehiculoDatos, novedad.Articulo)

    const cuotasDatos: TriunfoCuotaDato[] = Array.isArray(novedad.SDTCuota) ? novedad.SDTCuota : []

    // ── 1. Find or create Client ──────────────────────────

    let client = await this.prisma.client.findFirst({
      where: { dni, producerId, deletedAt: null },
      select: { id: true, email: true, firstName: true },
    })

    const isPlaceholderEmail = client?.email?.endsWith('@cliente.local')

    if (!client) {
      // Triunfo sometimes reuses the same email across different DNIs. Email is
      // unique per producer, so if the real email is already taken by ANOTHER
      // client, fall back to the per-DNI placeholder (always unique) instead of
      // crashing the upsert and dropping the policy.
      let email = realEmail ?? `${dni}@cliente.local`
      let realEmailTaken = false
      if (realEmail) {
        const emailOwner = await this.prisma.client.findFirst({
          where: { email: realEmail, producerId, deletedAt: null },
          select: { id: true },
        })
        if (emailOwner) {
          email = `${dni}@cliente.local`
          realEmailTaken = true
        }
      }
      // Same story for phone (unique per producer): drop it if already taken.
      let safePhone = phone
      if (phone) {
        const phoneOwner = await this.prisma.client.findFirst({
          where: { phone, producerId, deletedAt: null },
          select: { id: true },
        })
        if (phoneOwner) safePhone = null
      }

      const hashed = await bcrypt.hash(dni, 10)

      client = await this.prisma.client.create({
        data: {
          dni,
          firstName,
          lastName,
          email,
          // Force a password change only when the client has no usable real email
          // of their own (no real email, or it was already taken by someone else).
          requiresPasswordChange: !realEmail || realEmailTaken,
          password: hashed,
          phone: safePhone,
          city,
          producerId,
          producerCodeId,
        },
        select: { id: true, email: true, firstName: true },
      })

      if (realEmailTaken) {
        this.logger.debug(`DNI=${dni}: email ${realEmail} already in use — created with placeholder`)
      } else {
        this.logger.debug(`Created client DNI=${dni} email=${email}`)
      }
    } else if (isPlaceholderEmail && realEmail) {
      // Upgrade placeholder email to real one from Triunfo — try, ignore conflict
      try {
        await this.prisma.client.update({
          where: { id: client.id },
          data: {
            firstName,
            lastName,
            email: realEmail,
            phone: phone ?? undefined,
            city: city ?? undefined,
            requiresPasswordChange: true,
          },
        })
        this.logger.debug(`Updated client DNI=${dni} → real email ${realEmail}`)
      } catch {
        // Email conflict with another client — keep placeholder
      }
    }

    // ── 2. Upsert Poliza ──────────────────────────────────
    const poliza = await this.prisma.poliza.upsert({
      where: {
        certificado_producerId: { certificado, producerId },
      },
      create: {
        certificado,
        suplemento,
        company: 'triunfo',
        riskType,
        status,
        vigenciaDesde: vigDesde,
        vigenciaHasta: vigHasta,
        premio,
        paymentMethod,
        rawData: novedad as object,
        clientId: client.id,
        producerId,
        producerCodeId,
      },
      update: {
        suplemento,
        status,
        vigenciaHasta: vigHasta,
        premio,
        paymentMethod,
        rawData: novedad as object,
        producerCodeId,
      },
      select: { id: true },
    })

    // ── 3. Upsert Vehiculo (any policy with SDTVehiculoDatos) ─
    if (vehiculoDatos) {
      const v = vehiculoDatos
      const patente = v.Dominio?.trim() || null
      await this.prisma.vehiculo.upsert({
        where: { polizaId: poliza.id },
        create: {
          polizaId: poliza.id,
          dominio: patente,
          marca: v?.Marca ?? null,
          modelo: v?.Modelo ?? null,
          subModelo: v?.SubModelo ?? null,
          anio: v?.Anio ?? null,
          tipo: v?.Tipo ?? null,
          uso: v?.Uso ?? null,
          cobertura: v?.Cobertura ?? novedad.Cobertura ?? null,
          sumaAsegurada: v?.SumaAsegurada ?? null,
          ceroKm: (v?.CeroKm ?? 0) === 1,
          chasis: v?.Chasis ?? null,
          motor: v?.Motor ?? null,
        },
        update: {
          dominio: patente,
          marca: v?.Marca ?? null,
          modelo: v?.Modelo ?? null,
          subModelo: v?.SubModelo ?? null,
          anio: v?.Anio ?? null,
          tipo: v?.Tipo ?? null,
          uso: v?.Uso ?? null,
          cobertura: v?.Cobertura ?? novedad.Cobertura ?? null,
          sumaAsegurada: v?.SumaAsegurada ?? null,
          ceroKm: (v?.CeroKm ?? 0) === 1,
          chasis: v?.Chasis ?? null,
          motor: v?.Motor ?? null,
        },
      })
    }

    // ── 4. Upsert Cuotas ──────────────────────────────────
    for (const cuota of cuotasDatos) {
      const dueDate = isoDate(cuota.FechaVtoCuota)
      const status = mapCuotaStatus(cuota.Estado, dueDate)

      await this.prisma.cuota.upsert({
        where: {
          polizaId_numeroCuota: { polizaId: poliza.id, numeroCuota: cuota.NumeroCuota },
        },
        create: {
          polizaId: poliza.id,
          numeroCuota: cuota.NumeroCuota,
          amount: cuota.ImporteCuota,
          dueDate,
          status,
        },
        update: {
          amount: cuota.ImporteCuota,
          dueDate,
          status,
        },
      })
    }
  }
}
