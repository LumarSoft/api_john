import { Injectable, Logger } from '@nestjs/common'
import { Role } from 'generated/prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { ScopeService } from '../common/scope/scope.service'
import { PlanFeatures } from '../plan-features/plan-features'
import { UsersService } from '../users/users.service'
import { PhoneNumbersService } from '../phone-numbers/phone-numbers.service'
import { BusinessHoursService } from '../business-hours/business-hours.service'
import { NovedadesService } from '../novedades/novedades.service'
import { TasksService } from '../tasks/tasks.service'
import { SiniestrosService } from '../siniestros/siniestros.service'
import { SolicitudesService } from '../solicitudes/solicitudes.service'
import { ProposalsService } from '../improvements/proposals.service'
import { IntegrationStatusService } from '../integration-status/integration-status.service'
import { AssistantDataService } from './assistant-data.service'
import { AssistantActionsService } from './assistant-actions.service'
import { carteraTools } from './tools/cartera.tools'
import { configTools } from './tools/config.tools'
import { numbersTools } from './tools/numbers.tools'
import { workTools } from './tools/work.tools'
import { panelTools } from './tools/panel.tools'
import { undoTools } from './tools/undo.tools'
import { AssistantTool, ToolContext, ToolError } from './tools/tool.types'

/** A function tool as the model takes it. */
export interface ModelTool {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/**
 * Every tool the assistant has, built over the services the panel's own
 * screens use, and the actions they may propose (registered with
 * AssistantActionsService so a confirmation can run them).
 */
@Injectable()
export class AssistantToolsService {
  private readonly logger = new Logger(AssistantToolsService.name)
  private readonly tools: AssistantTool[]

  constructor(
    prisma: PrismaService,
    scope: ScopeService,
    data: AssistantDataService,
    actions: AssistantActionsService,
    users: UsersService,
    phoneNumbers: PhoneNumbersService,
    businessHours: BusinessHoursService,
    novedades: NovedadesService,
    tasks: TasksService,
    siniestros: SiniestrosService,
    solicitudes: SolicitudesService,
    proposals: ProposalsService,
    integrationStatus: IntegrationStatusService,
  ) {
    const sets = [
      carteraTools(data),
      configTools({ prisma, scope, users, phoneNumbers, businessHours, actions }),
      numbersTools({ prisma, scope, phoneNumbers, actions }),
      workTools({ prisma, scope, novedades, tasks, siniestros, solicitudes, proposals, actions }),
      panelTools(integrationStatus),
      undoTools(actions),
    ]
    this.tools = sets.flatMap(set => set.tools)
    actions.register(sets.flatMap(set => set.executors))
  }

  /** The tools this person may use now: by role, by plan, and actions only inside a saved conversation. */
  available(role: Role | undefined, features: PlanFeatures, canPropose: boolean): AssistantTool[] {
    return this.tools.filter(
      tool =>
        (!tool.roles || (role !== undefined && tool.roles.includes(role))) &&
        (!tool.feature || features[tool.feature]) &&
        (canPropose || !tool.proposes),
    )
  }

  /** The label the panel shows while a tool runs. */
  statusOf(name: string): string {
    return this.tools.find(tool => tool.name === name)?.status ?? 'Consultando'
  }

  /** Runs a tool the model asked for: a wrong call comes back as an error the model can fix, never as a crash. */
  async run(available: AssistantTool[], ctx: ToolContext, name: string, rawArgs: string): Promise<unknown> {
    const tool = available.find(t => t.name === name)
    if (!tool) return { error: `No existe la herramienta ${name}, o esta persona no puede usarla.` }
    let args: Record<string, unknown>
    try {
      args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {}
    } catch {
      return { error: 'Argumentos inválidos.' }
    }
    try {
      return await tool.run(ctx, args)
    } catch (error) {
      if (error instanceof ToolError) return { error: error.message }
      this.logger.warn(`Herramienta ${name} del asistente: ${(error as Error).message}`)
      return { error: 'No se pudo consultar ese dato.' }
    }
  }
}

export function asModelTools(tools: AssistantTool[]): ModelTool[] {
  return tools.map(({ name, description, parameters }) => ({ name, description, parameters }))
}
