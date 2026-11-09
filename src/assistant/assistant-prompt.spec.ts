import { cleanLinks, looksLikeCode, OFF_TOPIC_REPLY, systemPrompt } from './assistant-prompt'
import { PANEL_GUIDE, PANEL_SCREENS, PANEL_TOURS } from './panel-guide'

describe('systemPrompt', () => {
  const base = { orgName: 'Seguros Prueba', context: '- Nombre: Mili.', superAdmin: false }

  it('puts who is asking, the off-topic rule and the links the panel understands', () => {
    const prompt = systemPrompt({ ...base, canPropose: true })
    expect(prompt).toContain('Seguros Prueba')
    expect(prompt).toContain('- Nombre: Mili.')
    expect(prompt).toContain(OFF_TOPIC_REPLY)
    expect(prompt).toContain('hola mundo')
    expect(prompt).toContain('(asegurado:ID)')
    expect(prompt).toContain('(pantalla:ID)')
    expect(prompt).toContain('(recorrido:ID)')
    expect(prompt).toContain('"Confirmar"')
  })

  it('without a saved conversation, it explains instead of proposing', () => {
    const prompt = systemPrompt({ ...base, canPropose: false })
    expect(prompt).not.toContain('proponer_*')
    expect(prompt).toContain('no podés preparar cambios')
  })

  it('lists the exact destinations, with the record id where a screen takes one', () => {
    const prompt = systemPrompt({ ...base, canPropose: true })
    expect(prompt).toContain('- config-horarios: Configuración › Horarios')
    expect(prompt).toContain('- numero-pagos/ID: ')
  })

  it('offers the SuperAdmin screens only to a SuperAdmin', () => {
    expect(systemPrompt({ ...base, canPropose: true })).not.toContain('- usuarios: Usuarios')
    expect(systemPrompt({ ...base, superAdmin: true, canPropose: true })).toContain('- usuarios: Usuarios')
  })
})

describe('looksLikeCode', () => {
  it('spots code in any common shape', () => {
    for (const reply of [
      '```\nalgo\n```',
      'Usá console.log("Hola mundo")',
      'print("Hola mundo")',
      'def saludar():\n    return 1',
      'function saludar() { return 1 }',
      'const saludo = "hola"',
      '<script>alert(1)</script>',
      'public static void main(String[] args)',
      'import React from "react"',
      '<?php echo "hola"; ?>',
    ]) {
      expect(looksLikeCode(reply)).toBe(true)
    }
  })

  it('leaves the office’s answers alone', () => {
    for (const reply of [
      'La póliza de [Juan Perez](asegurado:60) está **vigente** y vence el 12/12/2026.',
      '- **3 cuotas vencidas**: $ 45.300 en total\n- 1 rechazada por el débito',
      'Entrá a Rechazos › Cargar Excel y elegí el archivo de Triunfo.',
      'La franquicia es el monto que paga el asegurado en cada siniestro (por ejemplo $ 150.000).',
      'Constante: la cuota sube un 8 % => $ 21.600 por mes.',
      OFF_TOPIC_REPLY,
    ]) {
      expect(looksLikeCode(reply)).toBe(false)
    }
  })
})

describe('cleanLinks', () => {
  it('keeps the links with a client id and turns the rest into plain names', () => {
    expect(cleanLinks('[Juan Perez](asegurado:60) y [Ana](asegurado:?) y [Luis](asegurado:)')).toBe(
      '[Juan Perez](asegurado:60) y Ana y Luis',
    )
  })

  it('keeps a tour link only when the panel has that tour', () => {
    expect(cleanLinks('Entrá a Rechazos.\n\n[Mostrame en pantalla](recorrido:cargar-rechazos)')).toBe(
      'Entrá a Rechazos.\n\n[Mostrame en pantalla](recorrido:cargar-rechazos)',
    )
    expect(cleanLinks('Entrá a Usuarios. [Mostrame en pantalla](recorrido:nuevo-usuario)')).toBe('Entrá a Usuarios.')
  })

  it('keeps a screen link only to a screen the panel has, else its text', () => {
    expect(cleanLinks('[Ir a Configuración](pantalla:configuracion)')).toBe(
      '[Ir a Configuración](pantalla:configuracion)',
    )
    expect(cleanLinks('Andá a [Reportes](pantalla:reportes).')).toBe('Andá a Reportes.')
    expect(cleanLinks('[Ir a sus pagos](pantalla:numero-pagos/12)')).toBe('[Ir a sus pagos](pantalla:numero-pagos/12)')
  })
})

describe('panel tours and screens', () => {
  it('lists every tour, by its id, in the guide the assistant reads', () => {
    for (const tour of PANEL_TOURS) expect(PANEL_GUIDE).toContain(`- ${tour.id}: `)
    expect(new Set(PANEL_TOURS.map(tour => tour.id)).size).toBe(PANEL_TOURS.length)
  })

  it('has one entry per screen id', () => {
    expect(new Set(PANEL_SCREENS.map(screen => screen.id)).size).toBe(PANEL_SCREENS.length)
  })
})
