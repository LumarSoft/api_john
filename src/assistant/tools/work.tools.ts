import { NotFoundException } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { numberWhere, ScopeService } from '../../common/scope/scope.service'
import { NovedadesService } from '../../novedades/novedades.service'
import { ListNovedadesDto, MatterCategory, MatterStatus, UpdateMatterDto } from '../../novedades/dto/list-novedades.dto'
import { TasksService } from '../../tasks/tasks.service'
import { CreateTaskDto } from '../../tasks/dto/task.dto'
import { SiniestrosService } from '../../siniestros/siniestros.service'
import { UpdateSiniestroDto } from '../../siniestros/dto/update-siniestro.dto'
import { SolicitudesService } from '../../solicitudes/solicitudes.service'
import { UpdateSolicitudDto } from '../../solicitudes/dto/update-solicitud.dto'
import { LeadKind, LEAD_STATUSES } from '../../solicitudes/solicitudes.types'
import { ProposalsService } from '../../improvements/proposals.service'
import { AssistantActionsService } from '../assistant-actions.service'
import {
  assertValidDto,
  compact,
  optionalBool,
  optionalText,
  requiredInt,
  requiredText,
  sameValue,
  shown,
  todayIso,
} from './tool-helpers'
import { ActionChange, ToolContext, ToolError, ToolSet } from './tool.types'

export interface WorkToolDeps {
  prisma: PrismaService
  scope: ScopeService
  novedades: NovedadesService
  tasks: TasksService
  siniestros: SiniestrosService
  solicitudes: SolicitudesService
  proposals: ProposalsService
  actions: AssistantActionsService
}

const MATTER_STATUS: Record<string, string> = {
  pending: 'Pendiente',
  in_progress: 'En atención',
  resolved: 'Resuelto',
}
const MATTER_CATEGORY: Record<string, string> = {
  baja: 'Bajas',
  pagos: 'Pagos y cobranza',
  cotizacion: 'Cotizaciones y contratación',
  siniestro: 'Siniestros',
  documentos: 'Documentación y cambios',
  other: 'Por clasificar',
}
const CLAIM_STATUS: Record<string, string> = { pending: 'Pendiente', in_progress: 'En proceso', resolved: 'Resuelto' }
const LEAD_STATUS: Record<string, string> = { NEW: 'Nueva', CONTACTED: 'Contactada', CLOSED: 'Cerrada' }

const PAGE = 15
const WAITING = 'Esperando que la persona toque Confirmar en la tarjeta.'

/** The office's day-to-day: pending matters, tasks, claims, quote requests and improvement proposals. */
export function workTools(deps: WorkToolDeps): ToolSet {
  const { scope, novedades, tasks, siniestros, solicitudes, proposals, actions } = deps

  /** A service's 404 inside a tool is the model's mistake (a wrong id or one outside the user's codes). */
  async function found<T>(promise: Promise<T>, what: string): Promise<T> {
    try {
      return await promise
    } catch (error) {
      if (error instanceof NotFoundException) throw new ToolError(`No encontré ${what} entre los que ve esta persona.`)
      throw error
    }
  }

  async function teammate(ctx: ToolContext, id: number) {
    const person = (await tasks.people(ctx.user.producerId)).find(p => p.id === id)
    if (!person) throw new ToolError(`No hay nadie del equipo con id ${id}. Usá ver_equipo.`)
    return person
  }

  return {
    tools: [
      {
        name: 'ver_asuntos_pendientes',
        status: 'Revisando los asuntos pendientes',
        description:
          'Asuntos pendientes del equipo (clientes que pidieron un asesor, bajas, siniestros, solicitudes, avisos), los más nuevos primero (hasta 15 y el total), con los contadores por categoría. Por defecto los que están por atender.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            estado: { type: 'string', enum: ['por_atender', 'pending', 'in_progress', 'resolved', 'todos'] },
            categoria: { type: 'string', enum: Object.keys(MATTER_CATEGORY) },
            buscar: { type: 'string', description: 'Cliente, teléfono o motivo.' },
          },
        },
        run: async (ctx, args) => {
          const chats = await scope.resolveChatScope(ctx.user, ctx.codeIds)
          const estado = optionalText(args, 'estado') ?? 'por_atender'
          const query: ListNovedadesDto = {
            pageSize: PAGE,
            ...(estado === 'por_atender' ? { actionable: true } : {}),
            ...(estado in MATTER_STATUS ? { status: estado as MatterStatus } : {}),
            ...(optionalText(args, 'categoria') ? { category: optionalText(args, 'categoria') as MatterCategory } : {}),
            ...(optionalText(args, 'buscar') ? { search: optionalText(args, 'buscar') } : {}),
          }
          const [list, stats] = await Promise.all([
            novedades.listForAdmin(ctx.user.producerId, chats, query),
            novedades.getStats(ctx.user.producerId, chats),
          ])
          return compact({
            total: list.total,
            porCategoria: stats.actionableByCategory,
            asuntos: list.data.map(item => ({
              ...item,
              category: MATTER_CATEGORY[item.category as string] ?? item.category,
              status: MATTER_STATUS[item.status as string] ?? item.status,
            })),
          })
        },
      },
      {
        name: 'ver_tareas',
        status: 'Revisando las tareas',
        description:
          'Tareas internas del equipo: vista "mias" (asignadas a esta persona), "asignadas" (las que esta persona le dio a otros) o "equipo" (todas, solo SuperAdmin). Por defecto las que están por hacer.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            vista: { type: 'string', enum: ['mias', 'asignadas', 'equipo'] },
            hechas: { type: 'boolean', description: 'true para ver las ya hechas.' },
          },
        },
        run: async (ctx, args) => {
          const view = { mias: 'mine', asignadas: 'created', equipo: 'all' }[optionalText(args, 'vista') ?? 'mias']
          if (view === 'all' && ctx.user.role !== Role.SUPERADMIN) {
            throw new ToolError('La vista de todo el equipo es solo para el SuperAdmin.')
          }
          const list = await tasks.list(ctx.user, {
            view: (view ?? 'mine') as 'mine' | 'created' | 'all',
            status: optionalBool(args, 'hechas') ? 'done' : 'open',
          })
          return compact(list)
        },
      },
      {
        name: 'ver_equipo',
        status: 'Buscando al equipo',
        description:
          'Las personas de la organización (id, nombre, correo y rol): para asignar una tarea o saber a quién nombran.',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        run: ctx => tasks.people(ctx.user.producerId),
      },
      {
        name: 'proponer_tarea',
        status: 'Preparando la tarea',
        proposes: true,
        description:
          'Prepara una tarea para alguien del equipo (o para la misma persona) y muestra la tarjeta para confirmarla. para_id sale de ver_equipo. fecha en YYYY-MM-DD (hoy, mañana o la que digan); sin fecha si no la dicen.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['para_id', 'titulo'],
          properties: {
            para_id: { type: 'integer' },
            titulo: {
              type: 'string',
              description: 'Qué hay que hacer, corto: "Llamar a Juan Pérez por la renovación".',
            },
            detalle: { type: 'string' },
            fecha: { type: 'string', description: 'Para cuándo, YYYY-MM-DD.' },
            contacto_nombre: { type: 'string', description: 'Si viene de un llamado: quién llamó.' },
            contacto_telefono: { type: 'string' },
          },
        },
        run: async (ctx, args) => {
          const assignee = await teammate(ctx, requiredInt(args, 'para_id', 'a quién se le asigna'))
          const dto = await assertValidDto(CreateTaskDto, {
            title: requiredText(args, 'titulo', 'qué hay que hacer'),
            assignedToUserId: assignee.id,
            ...(optionalText(args, 'detalle') ? { description: optionalText(args, 'detalle') } : {}),
            ...(optionalText(args, 'fecha') ? { dueDate: optionalText(args, 'fecha') } : {}),
            ...(optionalText(args, 'contacto_nombre') ? { contactName: optionalText(args, 'contacto_nombre') } : {}),
            ...(optionalText(args, 'contacto_telefono')
              ? { contactPhone: optionalText(args, 'contacto_telefono') }
              : {}),
          })
          if (dto.dueDate && dto.dueDate < todayIso(ctx.now)) throw new ToolError('La fecha ya pasó.')
          const rows: ActionChange[] = [
            {
              label: 'Para',
              before: null,
              after: assignee.id === ctx.user.id ? 'Vos' : (assignee.name ?? assignee.email),
            },
            { label: 'Qué hay que hacer', before: null, after: dto.title },
          ]
          if (dto.description) rows.push({ label: 'Detalle', before: null, after: dto.description })
          rows.push({
            label: 'Para cuándo',
            before: null,
            after: dto.dueDate ? dayText(dto.dueDate, ctx.now) : 'Sin fecha',
          })
          if (dto.contactName || dto.contactPhone) {
            rows.push({
              label: 'Llamado de',
              before: null,
              after: [dto.contactName, dto.contactPhone].filter(Boolean).join(' · '),
            })
          }
          const view = await actions.propose(
            ctx,
            'tarea',
            { ...dto },
            { title: 'Crear una tarea', target: 'Tareas', changes: rows, notes: [], confirmLabel: 'Crear la tarea' },
          )
          return { propuesta: view.id, estado: WAITING }
        },
      },
      {
        name: 'proponer_estado_asunto',
        status: 'Preparando el cambio del asunto',
        proposes: true,
        description:
          'Prepara el cambio de estado (pending, in_progress, resolved) o de categoría de un asunto pendiente (id de ver_asuntos_pendientes) y muestra la tarjeta para confirmarlo.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: {
            id: { type: 'integer' },
            estado: { type: 'string', enum: Object.keys(MATTER_STATUS) },
            categoria: { type: 'string', enum: Object.keys(MATTER_CATEGORY) },
          },
        },
        run: async (ctx, args) => {
          const id = requiredInt(args, 'id', 'el asunto')
          const dto = await assertValidDto(UpdateMatterDto, {
            ...(optionalText(args, 'estado') ? { status: optionalText(args, 'estado') } : {}),
            ...(optionalText(args, 'categoria') ? { category: optionalText(args, 'categoria') } : {}),
          })
          if (!dto.status && !dto.category) throw new ToolError('Falta el estado o la categoría nueva.')
          // Only a matter this person sees in Asuntos pendientes: its title names a client.
          const chats = await scope.resolveChatScope(ctx.user, ctx.codeIds)
          const matter = await novedades.findMatterForAdmin(id, ctx.user.producerId, chats)
          if (!matter) throw new ToolError('No encontré ese asunto entre los que ve esta persona.')
          const rows: ActionChange[] = []
          if (dto.status) {
            rows.push({
              label: 'Estado',
              before: MATTER_STATUS[matter.status ?? ''] ?? null,
              after: MATTER_STATUS[dto.status],
            })
          }
          if (dto.category) {
            rows.push({
              label: 'Categoría',
              before: MATTER_CATEGORY[matter.category ?? ''] ?? null,
              after: MATTER_CATEGORY[dto.category],
            })
          }
          const changed = rows.filter(r => r.before !== r.after)
          if (!changed.length) throw new ToolError('El asunto ya está así.')
          const view = await actions.propose(
            ctx,
            'asunto',
            { id, dto: { ...dto } },
            {
              title: 'Cambiar un asunto pendiente',
              target: matter.title,
              changes: changed,
              notes: [],
              confirmLabel: 'Guardar',
            },
            {
              id,
              dto: {
                ...(dto.status ? { status: matter.status } : {}),
                ...(dto.category ? { category: matter.category } : {}),
              },
            },
          )
          return { propuesta: view.id, estado: WAITING }
        },
      },
      {
        name: 'ver_siniestros',
        status: 'Revisando los siniestros',
        description:
          'Siniestros denunciados de la cartera (hasta 15 y el total), con asegurado, póliza, estado (pending, in_progress, resolved) y N° de siniestro de la compañía.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            estado: { type: 'string', enum: ['pending', 'in_progress', 'resolved'] },
            buscar: { type: 'string', description: 'Nombre, DNI, certificado o número.' },
          },
        },
        run: async (ctx, args) => {
          const list = await siniestros.findAllForAdmin(ctx.user.producerId, ctx.codeIds, {
            pageSize: PAGE,
            ...(optionalText(args, 'estado') ? { status: optionalText(args, 'estado') as never } : {}),
            ...(optionalText(args, 'buscar') ? { search: optionalText(args, 'buscar') } : {}),
          })
          return compact({
            total: list.total,
            siniestros: list.data.map(s => ({
              ...s,
              attachments: undefined,
              status: CLAIM_STATUS[s.status] ?? s.status,
            })),
          })
        },
      },
      {
        name: 'proponer_cambio_siniestro',
        status: 'Preparando el cambio del siniestro',
        proposes: true,
        description:
          'Prepara el cambio de estado de un siniestro (pending, in_progress, resolved) y/o el N° de siniestro de la compañía, y muestra la tarjeta para confirmarlo.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: {
            id: { type: 'integer' },
            estado: { type: 'string', enum: ['pending', 'in_progress', 'resolved'] },
            numero_compania: { type: 'string' },
          },
        },
        run: async (ctx, args) => {
          const id = requiredInt(args, 'id', 'el siniestro')
          const dto = await assertValidDto(UpdateSiniestroDto, {
            ...(optionalText(args, 'estado') ? { status: optionalText(args, 'estado') } : {}),
            ...(typeof args.numero_compania === 'string' ? { insurerClaimNumber: args.numero_compania.trim() } : {}),
          })
          if (dto.status === undefined && dto.insurerClaimNumber === undefined) {
            throw new ToolError('Falta el estado o el N° de siniestro de la compañía.')
          }
          const claim = await found(siniestros.findOneForAdmin(id, ctx.user.producerId, ctx.codeIds), 'ese siniestro')
          const rows: ActionChange[] = []
          if (dto.status)
            rows.push({ label: 'Estado', before: CLAIM_STATUS[claim.status], after: CLAIM_STATUS[dto.status] })
          if (dto.insurerClaimNumber !== undefined) {
            rows.push({
              label: 'N° de siniestro de la compañía',
              before: shown(claim.insurerClaimNumber),
              after: shown(dto.insurerClaimNumber),
            })
          }
          const changed = rows.filter(r => r.before !== r.after)
          if (!changed.length) throw new ToolError('El siniestro ya está así.')
          const client = claim.client as { firstName?: string | null; lastName?: string | null } | null
          const view = await actions.propose(
            ctx,
            'siniestro',
            { id, dto: { ...dto } },
            {
              title: 'Actualizar un siniestro',
              target: [`Siniestro #${id}`, [client?.firstName, client?.lastName].filter(Boolean).join(' ')]
                .filter(Boolean)
                .join(' · '),
              changes: changed,
              notes: [],
              confirmLabel: 'Guardar',
            },
            {
              id,
              dto: {
                ...(dto.status ? { status: claim.status } : {}),
                ...(dto.insurerClaimNumber !== undefined ? { insurerClaimNumber: claim.insurerClaimNumber ?? '' } : {}),
              },
            },
          )
          return { propuesta: view.id, estado: WAITING }
        },
      },
      {
        name: 'ver_solicitudes',
        status: 'Revisando las solicitudes',
        description:
          'Solicitudes de cotización de la web y del bot (hasta 15 y el total): tipo (lead o cotizacion), producto, contacto, estado (NEW, CONTACTED, CLOSED) y resumen.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            estado: { type: 'string', enum: [...LEAD_STATUSES] },
            buscar: { type: 'string', description: 'Nombre, teléfono o email.' },
          },
        },
        run: async (ctx, args) => {
          const chats = await scope.resolveChatScope(ctx.user, ctx.codeIds)
          const list = await solicitudes.listForAdmin(
            ctx.user.producerId,
            ctx.codeIds,
            {
              pageSize: PAGE,
              ...(optionalText(args, 'estado') ? { status: optionalText(args, 'estado') as never } : {}),
              ...(optionalText(args, 'buscar') ? { search: optionalText(args, 'buscar') } : {}),
            },
            numberWhere(chats),
          )
          return compact({
            total: list.total,
            solicitudes: list.data.map(s => ({ ...s, status: LEAD_STATUS[s.status] ?? s.status })),
          })
        },
      },
      {
        name: 'proponer_cambio_solicitud',
        status: 'Preparando el cambio de la solicitud',
        proposes: true,
        description:
          'Prepara el cambio de estado (NEW, CONTACTED, CLOSED) y/o de las notas internas de una solicitud (tipo e id de ver_solicitudes) y muestra la tarjeta. Las notas reemplazan a las actuales: si hay que sumar, incluí las anteriores.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['tipo', 'id'],
          properties: {
            tipo: { type: 'string', enum: ['lead', 'cotizacion'] },
            id: { type: 'integer' },
            estado: { type: 'string', enum: [...LEAD_STATUSES] },
            notas: { type: 'string' },
          },
        },
        run: async (ctx, args) => {
          const kind = (optionalText(args, 'tipo') === 'cotizacion' ? 'cotizacion' : 'lead') as LeadKind
          const id = requiredInt(args, 'id', 'la solicitud')
          const dto = await assertValidDto(UpdateSolicitudDto, {
            ...(optionalText(args, 'estado') ? { status: optionalText(args, 'estado') } : {}),
            ...(typeof args.notas === 'string' ? { notes: args.notas.trim() } : {}),
          })
          if (dto.status === undefined && dto.notes === undefined) throw new ToolError('Falta el estado o las notas.')
          const chats = await scope.resolveChatScope(ctx.user, ctx.codeIds)
          const detail = (await found(
            solicitudes.getDetail(ctx.user.producerId, ctx.codeIds, kind, id, numberWhere(chats)),
            'esa solicitud',
          )) as { status: string; notes?: string | null; contactName?: string | null }
          const rows: ActionChange[] = []
          if (dto.status)
            rows.push({ label: 'Estado', before: LEAD_STATUS[detail.status], after: LEAD_STATUS[dto.status] })
          if (dto.notes !== undefined) {
            rows.push({ label: 'Notas internas', before: shown(detail.notes), after: shown(dto.notes) })
          }
          const changed = rows.filter(r => r.before !== r.after)
          if (!changed.length) throw new ToolError('La solicitud ya está así.')
          const view = await actions.propose(
            ctx,
            'solicitud',
            { kind, id, dto: { ...dto } },
            {
              title: 'Actualizar una solicitud',
              target: detail.contactName ?? `Solicitud #${id}`,
              changes: changed,
              notes: [],
              confirmLabel: 'Guardar',
            },
            {
              kind,
              id,
              dto: {
                ...(dto.status ? { status: detail.status } : {}),
                ...(dto.notes !== undefined ? { notes: detail.notes ?? '' } : {}),
              },
            },
          )
          return { propuesta: view.id, estado: WAITING }
        },
      },
      {
        name: 'proponer_mejora',
        status: 'Preparando la propuesta de mejora',
        proposes: true,
        description:
          'Prepara una propuesta de mejora del panel o del bot para Mejoras › Propuestas (la ve toda la organización y le llega al equipo que desarrolla el panel) y muestra la tarjeta para enviarla. Antes ayudá a ordenarla: qué pasa hoy, qué se propone y un ejemplo.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['titulo', 'descripcion'],
          properties: {
            titulo: { type: 'string', description: 'Corto y concreto, hasta 140 caracteres.' },
            descripcion: {
              type: 'string',
              description: 'Qué pasa hoy, qué se propone y un ejemplo (20 a 5000 caracteres).',
            },
          },
        },
        run: async (ctx, args) => {
          const title = requiredText(args, 'titulo', 'el título')
          const description = requiredText(args, 'descripcion', 'el texto')
          if (title.length > 140 || description.length < 20 || description.length > 5000) {
            throw new ToolError('El título tiene que tener hasta 140 caracteres y el texto entre 20 y 5000.')
          }
          const view = await actions.propose(
            ctx,
            'mejora',
            { title, description },
            {
              title: 'Enviar una propuesta de mejora',
              target: 'Mejoras › Propuestas',
              changes: [
                { label: 'Título', before: null, after: title },
                { label: 'Detalle', before: null, after: description },
              ],
              notes: ['La ve toda la organización y le llega al equipo que desarrolla el panel.'],
              confirmLabel: 'Enviar la propuesta',
            },
          )
          return { propuesta: view.id, estado: WAITING }
        },
      },
    ],
    executors: [
      {
        type: 'tarea',
        async execute(user, _codeIds, payload) {
          await tasks.create(user, payload as unknown as CreateTaskDto)
          return {
            summary: 'Listo: la tarea quedó creada.',
            refresh: ['tasks'],
            link: {
              route: `/admin/tareas?vista=${Number(payload.assignedToUserId) === user.id ? 'mine' : 'created'}`,
              label: 'Ver en Tareas',
            },
          }
        },
      },
      {
        type: 'asunto',
        async stillApplied(user, codeIds, payload) {
          const dto = payload.dto as UpdateMatterDto
          const chats = await scope.resolveChatScope(user, codeIds)
          const matter = await novedades.findMatterForAdmin(Number(payload.id), user.producerId, chats)
          return (
            matter != null &&
            (dto.status === undefined || sameValue(matter.status, dto.status)) &&
            (dto.category === undefined || sameValue(matter.category, dto.category))
          )
        },
        async execute(user, codeIds, payload) {
          const chats = await scope.resolveChatScope(user, codeIds)
          await novedades.updateMatter(Number(payload.id), user.producerId, chats, payload.dto as UpdateMatterDto)
          return {
            summary: 'Listo: el asunto quedó actualizado.',
            refresh: ['novedades'],
            link: { route: '/admin/novedades', label: 'Ver en Asuntos pendientes' },
          }
        },
      },
      {
        type: 'siniestro',
        async stillApplied(user, codeIds, payload) {
          const dto = payload.dto as UpdateSiniestroDto
          const claim = await siniestros.findOneForAdmin(Number(payload.id), user.producerId, codeIds).catch(() => null)
          return (
            claim != null &&
            (dto.status === undefined || sameValue(claim.status, dto.status)) &&
            (dto.insurerClaimNumber === undefined || sameValue(claim.insurerClaimNumber, dto.insurerClaimNumber))
          )
        },
        async execute(user, codeIds, payload) {
          await siniestros.updateForAdmin(
            Number(payload.id),
            user.producerId,
            codeIds,
            payload.dto as UpdateSiniestroDto,
          )
          return {
            summary: 'Listo: el siniestro quedó actualizado.',
            refresh: ['siniestros'],
            link: { route: `/admin/siniestros?siniestro=${Number(payload.id)}`, label: 'Ver el siniestro' },
          }
        },
      },
      {
        type: 'solicitud',
        async stillApplied(user, codeIds, payload) {
          const dto = payload.dto as UpdateSolicitudDto
          const chats = await scope.resolveChatScope(user, codeIds)
          const detail = (await solicitudes
            .getDetail(user.producerId, codeIds, payload.kind as LeadKind, Number(payload.id), numberWhere(chats))
            .catch(() => null)) as { status: string; notes?: string | null } | null
          return (
            detail != null &&
            (dto.status === undefined || sameValue(detail.status, dto.status)) &&
            (dto.notes === undefined || sameValue(detail.notes, dto.notes))
          )
        },
        async execute(user, codeIds, payload) {
          const chats = await scope.resolveChatScope(user, codeIds)
          await solicitudes.updateStatus(
            user.producerId,
            codeIds,
            payload.kind as LeadKind,
            Number(payload.id),
            payload.dto as UpdateSolicitudDto,
            numberWhere(chats),
          )
          return {
            summary: 'Listo: la solicitud quedó actualizada.',
            refresh: ['solicitudes'],
            link: {
              route: `/admin/solicitudes?kind=${String(payload.kind)}&id=${Number(payload.id)}`,
              label: 'Ver la solicitud',
            },
          }
        },
      },
      {
        type: 'mejora',
        async execute(user, _codeIds, payload) {
          await proposals.create(user.producerId, user.id, {
            title: String(payload.title),
            description: String(payload.description),
          })
          return {
            summary: 'Listo: la propuesta quedó enviada.',
            refresh: ['improvement-proposals'],
            link: { route: '/admin/mejoras?tab=propuestas', label: 'Ver en Mejoras › Propuestas' },
          }
        },
      },
    ],
  }
}

/** "hoy", "mañana" or 25/12/2026. */
function dayText(iso: string, now: Date): string {
  const today = todayIso(now)
  const tomorrow = todayIso(new Date(now.getTime() + 86_400_000))
  if (iso === today) return 'Hoy'
  if (iso === tomorrow) return 'Mañana'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
