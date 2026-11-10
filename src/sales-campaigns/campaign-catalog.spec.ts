import { BadRequestException } from '@nestjs/common'
import {
  CAMPAIGNS,
  placeholdersIn,
  renderBody,
  settingsOf,
  templateParams,
  toTemplateText,
  validateBody,
  withSettings,
} from './campaign-catalog'

const upgrade = CAMPAIGNS.coverage_upgrade

describe('campaign messages', () => {
  it('turns the office placeholders into Meta variables, in order, and fills them back', () => {
    const body = '¡Hola, {nombre}! Tu {bien} con un {porcentaje}% menos. ¿Te interesa, {nombre}?'
    expect(placeholdersIn(body)).toEqual(['nombre', 'bien', 'porcentaje', 'nombre'])
    expect(toTemplateText(body)).toBe('¡Hola, {{1}}! Tu {{2}} con un {{3}}% menos. ¿Te interesa, {{4}}?')
    const values = { nombre: 'Juan', bien: 'Ford Ka', porcentaje: '15' }
    expect(templateParams(body, values)).toEqual(['Juan', 'Ford Ka', '15', 'Juan'])
    expect(renderBody(body, values)).toBe('¡Hola, Juan! Tu Ford Ka con un 15% menos. ¿Te interesa, Juan?')
  })

  it('accepts every default text', () => {
    for (const campaign of Object.values(CAMPAIGNS)) {
      expect(validateBody(campaign, campaign.defaultBody)).toBe(campaign.defaultBody)
    }
  })

  it.each([
    ['', 'vacío'],
    ['{nombre}, te escribimos por tu seguro.', 'empezar ni terminar'],
    ['Hola, te escribimos por tu {bien}', 'empezar ni terminar'],
    ['Hola {nombre}{bien}, ¿cómo va?', 'seguidos'],
    ['Hola {vencimiento}, ¿cómo va?', '{vencimiento} no es un dato'],
    ['Hola {nombre, ¿cómo va?', 'llaves'],
    ['Hola\n\n\nqué tal', 'línea en blanco'],
    ['x'.repeat(1025), '1024'],
  ])('rejects "%s" before Meta does', (body, message) => {
    expect(() => validateBody(upgrade, body)).toThrow(BadRequestException)
    expect(() => validateBody(upgrade, body)).toThrow(message)
  })
})

describe('campaign settings', () => {
  it('fills what the office never set with the defaults', () => {
    expect(settingsOf(upgrade, null)).toEqual({
      basicCoverages: ['A', 'B', 'B1', 'C2', 'C2 Full'],
      reviewSumBelow: 0,
      cooldownDays: 90,
    })
    expect(settingsOf(upgrade, { cooldownDays: 30 })).toEqual({
      basicCoverages: ['A', 'B', 'B1', 'C2', 'C2 Full'],
      reviewSumBelow: 0,
      cooldownDays: 30,
    })
  })

  it('cleans coverage codes and checks numbers against their range', () => {
    expect(withSettings(upgrade, null, { basicCoverages: [' a', 'B1', 'b1', ''] }).basicCoverages).toEqual(['A', 'B1'])
    expect(() => withSettings(upgrade, null, { cooldownDays: 2 })).toThrow('entre 7 y 365')
    expect(() => withSettings(upgrade, null, { basicCoverages: [] })).toThrow('códigos')
    expect(() => withSettings(upgrade, null, { daysBefore: 10 })).toThrow('no tiene el ajuste')
    expect(() => withSettings(CAMPAIGNS.quote_followup, null, { afterDays: 10, withinDays: 5 })).toThrow('Hasta')
  })
})
