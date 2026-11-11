import { Injectable } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ScopeService, ScopeUser } from '../common/scope/scope.service'
import { parseBotProfile, TRANSFER_BY_OFFICE, TRANSFER_FIELDS } from '../common/bot-profile'
import { PLAN_FEATURES, PlanFeatures } from '../plan-features/plan-features'
import { formatToday } from './assistant-prompt'
import { numberLabel, visibleNumbers } from './tools/config.tools'

/** The panel screen the person is on when they ask. */
export interface PanelPage {
  route?: string
  screen?: string
}

export interface AssistantContext {
  orgName: string
  /** First name or e-mail: how the assistant may address them. */
  userName: string
  superAdmin: boolean
  /** The "who is asking" block of the prompt. */
  text: string
}

const MAX_CODES = 12
const MAX_NUMBERS = 12

/**
 * Who is asking, as the assistant needs to know it to help without asking
 * back: name, role, codes, the numbers they manage (and whose bank account
 * each one uses), what the plan includes and the screen they are on.
 */
@Injectable()
export class AssistantContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  async build(
    user: ScopeUser,
    codeIds: number[],
    features: PlanFeatures,
    blockedByRole: string[],
    page: PanelPage | undefined,
    now: Date,
  ): Promise<AssistantContext> {
    const [person, producer, codes, numbers] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: user.id }, select: { name: true, email: true } }),
      this.prisma.producer.findUnique({ where: { id: user.producerId }, select: { name: true, botProfile: true } }),
      this.prisma.producerCode.findMany({
        where: { id: { in: codeIds }, deletedAt: null },
        select: { code: true, holderName: true, isMaster: true },
        orderBy: [{ isMaster: 'desc' }, { code: 'asc' }],
      }),
      visibleNumbers({ prisma: this.prisma, scope: this.scope }, user),
    ])

    const orgName = parseBotProfile(producer?.botProfile).orgName || producer?.name || 'la organización'
    const superAdmin = user.role === Role.SUPERADMIN
    const userName = person?.name?.trim() || person?.email || 'la persona'

    const codeLines = codes
      .slice(0, MAX_CODES)
      .map(
        c => `${c.code}${c.holderName ? ` (${oneLine(c.holderName)})` : ''}${c.isMaster ? ', código principal' : ''}`,
      )
    if (codes.length > MAX_CODES) codeLines.push(`y ${codes.length - MAX_CODES} más`)

    const numberLines = numbers.slice(0, MAX_NUMBERS).map(n => {
      const own = parseBotProfile(n.botProfile)
      const traits = [
        n.isActive ? null : 'inactivo',
        n.botEnabled ? 'bot prendido' : 'bot apagado',
        own.transferMode === TRANSFER_BY_OFFICE
          ? 'no da cuenta para transferir: los datos los pasa la oficina'
          : TRANSFER_FIELDS.some(f => own[f] != null)
            ? 'cuenta para transferir propia'
            : 'usa la cuenta de la organización',
        n.businessHours == null ? null : 'horario propio',
      ].filter(Boolean)
      return `  - id ${n.id}: ${oneLine(numberLabel(n))} (${traits.join(', ')})`
    })
    if (numbers.length > MAX_NUMBERS) numberLines.push(`  - y ${numbers.length - MAX_NUMBERS} más (ver_numeros)`)

    const included = PLAN_FEATURES.filter(f => features[f.key]).map(f => f.label)
    const missing = PLAN_FEATURES.filter(f => !features[f.key] && !blockedByRole.includes(f.key)).map(f => f.label)

    const lines = [
      `- Nombre: ${oneLine(userName)}${person?.name ? ` (${person.email})` : ''}. Tratala por su nombre de pila si lo tiene.`,
      superAdmin
        ? '- Rol: SuperAdmin. Ve y configura toda la organización: todos los códigos, todos los números y Usuarios.'
        : '- Rol: Administrador. Ve solo los datos de sus códigos de productor y configura solo sus números; Usuarios, Balance y el alta de números son del SuperAdmin. La configuración general de la organización la cambia solo el SuperAdmin; en Configuración › Asistente cambia la de su número (nombre, personas, horario, feriados, datos, cuenta y coberturas).',
      `- Organización: ${oneLine(orgName)}.`,
      `- Códigos de productor que ve: ${codeLines.length ? codeLines.join('; ') : 'ninguno'}.`,
      numbers.length
        ? `- Números de WhatsApp que maneja:\n${numberLines.join('\n')}`
        : '- No maneja ningún número de WhatsApp.',
      `- El plan incluye: ${included.length ? included.join(', ') : 'las funciones básicas'}.${missing.length ? ` No incluye: ${missing.join(', ')}.` : ''}`,
      page?.screen || page?.route
        ? `- Está mirando: ${[page.screen, page.route].filter(Boolean).join(' · ')}. Si pregunta por "esto" o "acá", se refiere a esa pantalla.`
        : null,
      `- Hoy es ${formatToday(now)}.`,
    ].filter(Boolean)

    return { orgName, userName, superAdmin, text: lines.join('\n') }
  }
}

/** A value people typed elsewhere (a user's name, a branch) as one line of the instructions, never a new one. */
function oneLine(text: string): string {
  return text.replace(/[\r\n\t]+/g, ' ').trim()
}
