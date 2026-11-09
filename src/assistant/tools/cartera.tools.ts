import { AssistantDataService } from '../assistant-data.service'
import { optionalText, requiredInt, requiredText } from './tool-helpers'
import { ToolSet } from './tool.types'

/** The portfolio, read-only: clients, policies, installments and the summary (AssistantDataService). */
export function carteraTools(data: AssistantDataService): ToolSet {
  return {
    executors: [],
    tools: [
      {
        name: 'buscar_asegurados',
        status: 'Buscando asegurados',
        description:
          'Busca asegurados por nombre, apellido, DNI o CUIT, teléfono, email, patente o número de póliza. Devuelve hasta 8 con sus pólizas (estado y vencimiento). Usala antes de ver_asegurado cuando no sabés el id.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['texto'],
          properties: {
            texto: {
              type: 'string',
              description: 'Lo que se busca, por ejemplo "Juan Pérez", "20999001" o "AB123CD".',
            },
          },
        },
        run: (ctx, args) =>
          data.searchClients(ctx.user.producerId, ctx.codeIds, requiredText(args, 'texto', 'qué buscar')),
      },
      {
        name: 'ver_asegurado',
        status: 'Abriendo la ficha del asegurado',
        description:
          'La ficha de un asegurado: contacto, productor, cada póliza con cobertura, estado, vigencia, medio de pago, cuotas impagas y siniestros.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: { id: { type: 'integer', description: 'El id que devolvió buscar_asegurados.' } },
        },
        run: (ctx, args) => data.clientFile(ctx.user.producerId, ctx.codeIds, requiredInt(args, 'id', 'el id')),
      },
      {
        name: 'polizas_que_vencen',
        status: 'Revisando los vencimientos',
        description:
          'Pólizas vigentes que vencen dentro de los próximos días, las más próximas primero (hasta 15 y el total).',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['dias'],
          properties: {
            dias: { type: 'integer', description: 'Cuántos días hacia adelante, de 1 a 90 (una semana = 7).' },
            tipo: {
              type: 'string',
              enum: ['auto', 'moto', 'home', 'life', 'commercial', 'other'],
              description: 'Solo un tipo de riesgo.',
            },
          },
        },
        run: (ctx, args) =>
          data.expiringPolicies(
            ctx.user.producerId,
            ctx.codeIds,
            requiredInt(args, 'dias', 'la cantidad de días'),
            optionalText(args, 'tipo'),
            ctx.now,
          ),
      },
      {
        name: 'cuotas_impagas',
        status: 'Revisando las cuotas impagas',
        description:
          'Cuotas sin pagar de pólizas no anuladas, las más viejas primero (hasta 15 y el total), con el asegurado de cada una.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['estado'],
          properties: {
            estado: {
              type: 'string',
              enum: ['overdue', 'rejected', 'pending', 'unpaid'],
              description:
                'overdue = vencidas, rejected = rechazadas por el débito, pending = a vencer, unpaid = vencidas y rechazadas.',
            },
          },
        },
        run: (ctx, args) =>
          data.unpaidInstallments(ctx.user.producerId, ctx.codeIds, optionalText(args, 'estado') ?? 'unpaid'),
      },
      {
        name: 'resumen_cartera',
        status: 'Mirando los números de la cartera',
        description:
          'Números de la cartera: asegurados, pólizas vigentes por tipo, cuántas vencen en 30 días, cuotas vencidas y rechazadas, siniestros abiertos.',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        run: ctx => data.portfolioSummary(ctx.user.producerId, ctx.codeIds, ctx.now),
      },
    ],
  }
}
