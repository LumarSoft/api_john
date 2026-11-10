import {
  CampaignDefinition,
  CampaignSettings,
  codesSetting,
  CrossSellProduct,
  daysSetting,
  GAP_LABELS,
  numberSetting,
} from './campaign-catalog'

/** "15 y 7", "hogar, vida o comercio": a list as a person says it. */
function listOf(items: Array<string | number>, last = 'y'): string {
  if (items.length < 2) return String(items[0] ?? '')
  return `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`
}

const days = (n: number) => (n === 1 ? '1 día' : `${n} días`)
const pesos = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`

/** What every campaign shares: the office sends, the replies are followed, a "no" is respected. */
const COMMON = [
  'Nada sale solo: tildás a quién escribirle y tocás «Enviar». Meta cobra cada mensaje de campaña como marketing. Si ya hablaste con el cliente por otro medio, usá «Ya lo contactamos».',
  'Lo que el cliente responde llega a Whatsapp. La columna Seguimiento muestra si respondió, cotizó o contrató, y con «Asignar a…» o «Crear tarea» se lo dejás a alguien de la oficina. El total está en la pestaña Resultados.',
  'Si el cliente pide que no le escriban más, el sistema lo saca solo de todas las campañas.',
]

/** Who the campaign finds and when it writes again, with the organization's own settings. */
function own(definition: CampaignDefinition, settings: CampaignSettings): string[] {
  const cooldown = `A quien ya le escribiste no te lo vuelve a ofrecer hasta que pasen ${days(numberSetting(settings, 'cooldownDays'))}.`
  switch (definition.kind) {
    case 'coverage_upgrade': {
      const basic = codesSetting(settings, 'basicCoverages')
      const sum = numberSetting(settings, 'reviewSumBelow')
      const who = [
        basic.length ? `con cobertura ${listOf(basic, 'o')}` : '',
        sum > 0 ? `asegurados por menos de ${pesos(sum)}` : '',
      ].filter(Boolean)
      return [
        `Busca en la cartera los autos y las motos vigentes ${listOf(who, 'o')}. El motivo dice qué le falta a cada uno (robo, granizo, cristales) o a qué cobertura se lo puede pasar, para que sepas qué ofrecerle.`,
        cooldown,
      ]
    }
    case 'quote_followup': {
      const second = numberSetting(settings, 'secondContactDays')
      return [
        `Busca a quienes cotizaron con el bot hace entre ${numberSetting(settings, 'afterDays')} y ${days(numberSetting(settings, 'withinDays'))} y no siguieron, y a quienes pidieron contratar y todavía no tienen póliza. El motivo muestra la cuota más baja que se les cotizó.`,
        second > 0
          ? `Si no responde, a los ${days(second)} vuelve a aparecer arriba con la etiqueta «Segundo contacto» para escribirle una vez más. Si respondió, cotizó o contrató, no se le insiste.`
          : cooldown,
      ]
    }
    case 'renewal': {
      const first = numberSetting(settings, 'daysBefore')
      const reminders = daysSetting(settings, 'reminderDays').filter(d => d < first)
      return [
        `Busca las pólizas que vencen en los próximos ${days(first)} y todavía no tienen la renovación emitida. La que vence antes aparece primero.`,
        reminders.length
          ? `Si no responde, vuelve a aparecer arriba con la etiqueta «Recordatorio» cuando faltan ${listOf(reminders)} días para el vencimiento. Si respondió o ya renovó, no se le insiste.`
          : cooldown,
      ]
    }
    case 'winback':
      return [
        `Busca las pólizas anuladas, dadas de baja o vencidas sin renovar en los últimos ${days(numberSetting(settings, 'withinDays'))}, de clientes que no tienen otra vigente por el mismo bien. El motivo dice por qué se fue y, si se lo contó al bot, lo que dijo el cliente.`,
        cooldown,
      ]
    case 'cross_sell': {
      const offer = (codesSetting(settings, 'offer') as CrossSellProduct[]).map(p => GAP_LABELS[p].toLowerCase())
      return [
        `Busca clientes con un seguro vigente a los que les falta alguno de estos: ${offer.join('; ')}. El motivo dice qué tiene cada uno y qué le falta.`,
        cooldown,
      ]
    }
  }
}

/**
 * How a campaign works, for the top of its page: who it finds (with the
 * organization's settings), when it offers someone again, and what every
 * campaign shares.
 */
export function howItWorks(definition: CampaignDefinition, settings: CampaignSettings): string[] {
  return [...own(definition, settings), ...COMMON]
}
