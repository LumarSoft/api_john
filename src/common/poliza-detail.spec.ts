import { insuresAPerson, placeOf, productOf, riesgosOf } from './poliza-detail'

const raw = (items: Array<[string, string, string?]>, place?: string) => ({
  SDTOtrosRiesgosDatos: {
    SDTRiesgosCoberturas: items.map(([Riesgo, Cobertura, SumaAsegurada]) => ({
      Riesgo,
      Cobertura,
      SumaAsegurada: SumaAsegurada ?? '0.00',
    })),
    ...(place ? { ObjetoSeguroDescripcion: place } : {}),
  },
})

describe('poliza detail', () => {
  it('reads the coverages Triunfo lists, fixing its Ñ', () => {
    expect(
      riesgosOf(
        raw([
          ['ROBO', 'DA#OS ELECTROD/ELECT', '450000.00'],
          ['CRISTALES', 'CRISTALES'],
        ]),
      ),
    ).toEqual([
      { riesgo: 'ROBO', cobertura: 'DAÑOS ELECTROD/ELECT', sumaAsegurada: 450000 },
      { riesgo: 'CRISTALES', cobertura: 'CRISTALES', sumaAsegurada: null },
    ])
    expect(riesgosOf(null)).toEqual([])
    expect(riesgosOf({ SDTOtrosRiesgosDatos: 'x' })).toEqual([])
  })

  it('names a non-vehicle policy by what it covers', () => {
    const r = (items: Array<[string, string]>) => riesgosOf(raw(items))
    expect(productOf('other', r([['RESPONSABILIDAD CIVIL', 'RESP.CIVIL BICICLETA']]))).toBe('Bicicleta')
    expect(productOf('life', r([['SEPELIO', 'TITULAR']]))).toBe('Sepelio')
    expect(
      productOf(
        'life',
        r([
          ['CATEGORIA 2', 'MUERTE'],
          ['CATEGORIA 2', 'INCAP.TOTAL/PARCIAL'],
        ]),
      ),
    ).toBe('Acc. personales')
    expect(productOf('other', r([['EQUIPOS CONTRATISTAS', 'DA#OS TOTALES']]))).toBe('Equipos')
    expect(productOf('other', r([['RESPONSABILIDAD CIVIL', 'COLEGIO']]))).toBe('Resp. civil')
    expect(productOf('home', r([]))).toBe('Hogar')
    expect(productOf('commercial', r([]))).toBe('Comercio')
    expect(productOf('auto', r([]))).toBeNull()
    expect(productOf('other', r([]))).toBeNull()
  })

  it('names a policy on a person by its article when it lists no coverages, never as Vida', () => {
    expect(productOf('life', [], 128)).toBe('Acc. personales')
    expect(productOf('life', [], '195')).toBe('Acc. personales')
    expect(productOf('life', [], 197)).toBe('Sepelio')
    expect(productOf('life', [])).toBe('Vida')
  })

  it('tells a policy on a person from one on a thing', () => {
    expect(insuresAPerson(riesgosOf(raw([['CATEGORIA 4', 'MUERTE']])))).toBe(true)
    expect(insuresAPerson(riesgosOf(raw([['SEPELIO', 'TITULAR']])))).toBe(true)
    expect(
      insuresAPerson(
        riesgosOf(
          raw([
            ['ADICIONAL DE VIDA', 'TITULAR'],
            ['INCENDIO', 'EDIFICIO'],
          ]),
        ),
      ),
    ).toBe(false)
    expect(insuresAPerson([])).toBe(false)
  })

  it('gives the insured address of a home, never a person', () => {
    const home = raw([['INCENDIO', 'EDIFICIO']], 'SAN MARTIN 4060 C.P.:2000')
    expect(placeOf('home', home, riesgosOf(home))).toBe('San Martin 4060')
    const sepelio = raw([['SEPELIO', 'TITULAR']], 'PEREZ JUAN - DNI: 20000001')
    expect(placeOf('life', sepelio, riesgosOf(sepelio))).toBeNull()
    expect(placeOf('other', sepelio, riesgosOf(sepelio))).toBeNull()
    const anywhere = raw([['CATEGORIA 1', 'MUERTE']], 'CUALQUIER LUGAR. C.P.:1')
    expect(placeOf('other', anywhere, riesgosOf(anywhere))).toBeNull()
    expect(placeOf('auto', home, riesgosOf(home))).toBeNull()
  })
})
