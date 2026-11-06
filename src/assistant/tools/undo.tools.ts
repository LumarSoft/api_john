import { AssistantActionsService } from '../assistant-actions.service'
import { requiredInt } from './tool-helpers'
import { ToolSet } from './tool.types'

/** Going back on a confirmed change, with the exact values it replaced. */
export function undoTools(actions: AssistantActionsService): ToolSet {
  return {
    executors: [],
    tools: [
      {
        name: 'proponer_deshacer',
        status: 'Preparando cómo deshacerlo',
        proposes: true,
        description:
          'Prepara volver atrás un cambio que esta persona ya confirmó (datos de pago, datos de la organización, horarios, el bot de un número, el estado de un asunto, un siniestro o una solicitud), con los valores exactos que había antes, y muestra la tarjeta. Usala siempre que pidan deshacer o "dejarlo como estaba", con el número de la propuesta confirmada que figura en el historial (#N); nunca armes la vuelta atrás a mano. Crear tareas, cierres y propuestas de mejora no se deshacen acá.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          required: ['propuesta'],
          properties: { propuesta: { type: 'integer', description: 'El número de la propuesta confirmada.' } },
        },
        run: async (ctx, args) => {
          const view = await actions.proposeUndo(ctx, requiredInt(args, 'propuesta', 'el número de propuesta'))
          return { propuesta: view.id, estado: 'Esperando que la persona toque Confirmar en la tarjeta.' }
        },
      },
    ],
  }
}
