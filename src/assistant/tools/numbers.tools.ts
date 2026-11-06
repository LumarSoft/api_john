import { CreateClosureDto } from '../../business-hours/dto/create-closure.dto'
import { currentPeriod } from '../../usage/usage.service'
import { PhoneNumbersService } from '../../phone-numbers/phone-numbers.service'
import { AssistantActionsService } from '../assistant-actions.service'
import { ConfigToolDeps, numberLabel, ownNumber } from './config.tools'
import { assertValidDto, optionalBool, requiredInt, requiredText, todayIso } from './tool-helpers'
import { numberLink } from './panel-links'
import { ToolError, ToolSet } from './tool.types'

type NumbersToolDeps = Pick<ConfigToolDeps, 'prisma' | 'scope'> & {
  phoneNumbers: PhoneNumbersService
  actions: AssistantActionsService
}

interface NumberRow {
  id: number
  number: string
  branchName: string | null
  isActive: boolean
  botEnabled: boolean
  budgetExceededAt: string | null
  disconnectedAt: string | null
  disconnectReasonLabel?: string | null
  responsibleCode?: { code: string; holderName: string | null } | null
  assistant?: { botName: string | null; customized: boolean } | null
  usage?: {
    messages: number
    plan?: { name: string; includedMessages: number } | null
    planPaused?: boolean
  } | null
}

/** The organization's WhatsApp numbers: state, plan and use; turning the bot on or off; holidays and closures. */
export function numbersTools(deps: NumbersToolDeps): ToolSet {
  const { phoneNumbers, actions } = deps

  return {
    tools: [
      {
        name: 'ver_numeros',
        status: 'Revisando los números de WhatsApp',
        description:
          'Los números de WhatsApp que maneja la persona: id, sucursal, si está activo, conectado a WhatsApp y con el bot prendido, su código de productor, su plan de mensajes y cuánto usó este mes.',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        run: async ctx => {
          const rows = (await phoneNumbers.list(
            ctx.user.producerId,
            ctx.user.role,
            currentPeriod(ctx.now),
            ctx.user.id,
          )) as unknown as NumberRow[]
          return rows.map(n => ({
            id: n.id,
            numero: numberLabel(n),
            activo: n.isActive,
            botPrendido: n.botEnabled,
            desconectadoDeWhatsapp: n.disconnectedAt ? (n.disconnectReasonLabel ?? true) : false,
            codigo: n.responsibleCode ? `${n.responsibleCode.code} ${n.responsibleCode.holderName ?? ''}`.trim() : null,
            nombreDelAsistente: n.assistant?.botName ?? null,
            configuracionPropia: n.assistant?.customized ?? false,
            plan: n.usage?.plan?.name ?? null,
            mensajesIncluidos: n.usage?.plan?.includedMessages ?? null,
            mensajesUsadosEsteMes: n.usage?.messages ?? 0,
            pausadoPorElPlan: n.usage?.planPaused ?? false,
          }))
        },
      },
      {
        name: 'proponer_bot_numero',
        status: 'Preparando el cambio del bot',
        proposes: true,
        description:
          'Prepara prender o apagar el bot en un número (los demás números siguen igual) y muestra la tarjeta para confirmarlo. Apagado, la oficina contesta desde Whatsapp sin tomar cada chat.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['numero_id', 'prender'],
          properties: {
            numero_id: { type: 'integer', description: 'El id de ver_numeros.' },
            prender: { type: 'boolean', description: 'true prende el bot, false lo apaga.' },
          },
        },
        run: async (ctx, args) => {
          const id = requiredInt(args, 'numero_id', 'el número')
          const enable = optionalBool(args, 'prender')
          if (enable === undefined) throw new ToolError('Falta decir si se prende (true) o se apaga (false).')
          const number = await ownNumber(deps, ctx, id)
          if (number.botEnabled === enable) {
            throw new ToolError(`El bot de ese número ya está ${enable ? 'prendido' : 'apagado'}.`)
          }
          const view = await actions.propose(
            ctx,
            'bot_numero',
            { numberId: id, enable },
            {
              title: enable ? 'Prender el bot en este número' : 'Apagar el bot en este número',
              target: numberLabel(number),
              changes: [
                { label: 'Bot', before: enable ? 'Apagado' : 'Prendido', after: enable ? 'Prendido' : 'Apagado' },
              ],
              notes: enable
                ? ['El bot vuelve a contestar los mensajes nuevos de este número.']
                : [
                    'Los clientes que escriban a este número no reciben respuesta automática: la oficina contesta desde Whatsapp.',
                  ],
              confirmLabel: enable ? 'Prender el bot' : 'Apagar el bot',
            },
            { numberId: id, enable: !enable },
          )
          return { propuesta: view.id, estado: 'Esperando que la persona toque Confirmar en la tarjeta.' }
        },
      },
      {
        name: 'proponer_feriado_o_pausa',
        status: 'Preparando el cierre',
        proposes: true,
        description:
          'Prepara un día o un período cerrado (feriado, vacaciones, mudanza) en uno o varios números y muestra la tarjeta. El bot avisa que la oficina está cerrada y cuándo vuelve. Fechas YYYY-MM-DD; para un solo día, desde = hasta.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['numero_ids', 'desde', 'hasta', 'motivo'],
          properties: {
            numero_ids: { type: 'array', items: { type: 'integer' }, description: 'Ids de ver_numeros.' },
            desde: { type: 'string' },
            hasta: { type: 'string' },
            motivo: { type: 'string', description: 'Lo que el bot les dice a los clientes: "Feriado", "Vacaciones".' },
          },
        },
        run: async (ctx, args) => {
          const ids = Array.isArray(args.numero_ids)
            ? [...new Set(args.numero_ids.map(Number).filter(Number.isInteger))]
            : []
          if (!ids.length) throw new ToolError('Falta en qué números (numero_ids).')
          const closure = await assertValidDto(CreateClosureDto, {
            startDate: requiredText(args, 'desde', 'la fecha de inicio'),
            endDate: requiredText(args, 'hasta', 'la fecha de fin'),
            reason: requiredText(args, 'motivo', 'el motivo'),
          })
          if (closure.startDate > closure.endDate) throw new ToolError('La fecha de inicio es posterior a la de fin.')
          if (closure.endDate < todayIso(ctx.now)) throw new ToolError('Ese período ya pasó.')
          const numbers = await Promise.all(ids.map(id => ownNumber(deps, ctx, id)))
          const period =
            closure.startDate === closure.endDate
              ? formatDay(closure.startDate)
              : `del ${formatDay(closure.startDate)} al ${formatDay(closure.endDate)}`
          const view = await actions.propose(
            ctx,
            'cierre',
            { numberIds: ids, closure: { ...closure } },
            {
              title: 'Cargar un cierre',
              target: numbers.map(numberLabel).join(', '),
              changes: [
                { label: 'Cerrado', before: null, after: period },
                { label: 'Motivo', before: null, after: closure.reason },
              ],
              notes: ['El bot avisa que la oficina está cerrada y cuándo vuelve a atender.'],
              confirmLabel: 'Cargar el cierre',
            },
          )
          return { propuesta: view.id, estado: 'Esperando que la persona toque Confirmar en la tarjeta.' }
        },
      },
    ],
    executors: [
      {
        type: 'bot_numero',
        async execute(user, _codeIds, payload) {
          await phoneNumbers.setBotEnabled(Number(payload.numberId), user, Boolean(payload.enable))
          return {
            summary: payload.enable
              ? 'Listo: el bot volvió a contestar en ese número.'
              : 'Listo: el bot quedó apagado en ese número.',
            refresh: ['phone-numbers'],
            link: numberLink(Number(payload.numberId), 'numero-bot'),
          }
        },
      },
      {
        type: 'cierre',
        async execute(user, _codeIds, payload) {
          const ids = payload.numberIds as number[]
          const closure = payload.closure as CreateClosureDto
          for (const id of ids) await phoneNumbers.addClosure(id, user, closure)
          return {
            summary:
              ids.length === 1
                ? 'Listo: el cierre quedó cargado.'
                : `Listo: el cierre quedó cargado en ${ids.length} números.`,
            refresh: ['phone-numbers'],
            link: numberLink(ids[0], 'numero-feriados'),
          }
        },
      },
    ],
  }
}

/** 2026-12-25 → 25/12/2026. */
function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
