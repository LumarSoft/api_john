import { IntegrationStatusService } from '../../integration-status/integration-status.service'
import { PANEL_GUIDE } from '../panel-guide'
import { compact } from './tool-helpers'
import { ToolSet } from './tool.types'

/** How the panel works, and whether the services it depends on are up. */
export function panelTools(integrationStatus: IntegrationStatusService): ToolSet {
  return {
    executors: [],
    tools: [
      {
        name: 'como_usar_el_panel',
        status: 'Leyendo la guía del panel',
        description:
          'La guía del panel: para qué sirve cada sección, sus pestañas, campos y botones, y cómo se hacen las tareas habituales. Usala siempre que pregunten cómo hacer algo en el panel o dónde está algo.',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        run: () => Promise.resolve({ guia: PANEL_GUIDE }),
      },
      {
        name: 'estado_servicios',
        status: 'Revisando el estado de los servicios',
        description:
          'Si Triunfo, InfoAuto y los números de WhatsApp están andando: fallas abiertas, desde cuándo, qué afectan y qué hace falta para que vuelvan (lo mismo que la sección Status).',
        parameters: { type: 'object', additionalProperties: false, properties: {} },
        run: async ctx => compact(await integrationStatus.overview(ctx.user)),
      },
    ],
  }
}
