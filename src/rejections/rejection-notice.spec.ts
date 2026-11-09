import {
  channelOf,
  greetingName,
  noticeParams,
  reasonForClient,
  REJECTION_TEMPLATE,
  renderNotice,
} from './rejection-notice'

describe('reasonForClient', () => {
  it('says the known reasons in plain words', () => {
    expect(reasonForClient('FALTA DE FONDOS')).toBe('falta de fondos en la cuenta')
    expect(reasonForClient('CUENTA S/DISPONIBLE')).toBe('falta de saldo disponible en la tarjeta')
    expect(reasonForClient(' cta cerrada  o suspendida ')).toBe('cuenta cerrada o suspendida')
  })

  it('lowercases a reason it does not know', () => {
    expect(reasonForClient('CTA EMBARGADA')).toBe('cuenta embargada')
    expect(reasonForClient('TARJETA S/HABILITAR')).toBe('tarjeta sin habilitar')
  })
})

describe('channelOf', () => {
  it('tells cards from bank accounts by the entity', () => {
    expect(channelOf('VISA DEBITO')).toBe('CARD')
    expect(channelOf('TARJETA VISA')).toBe('CARD')
    expect(channelOf('NACION ARGENTINA')).toBe('ACCOUNT')
    expect(channelOf('BCO DE GALICIA')).toBe('ACCOUNT')
  })
})

describe('greetingName', () => {
  it('greets the client by first name when the policy is in the cartera', () => {
    expect(greetingName('PEREZ JUAN CARLOS', 'JUAN CARLOS')).toBe('Juan')
  })

  it('falls back to the holder as Triunfo writes it', () => {
    expect(greetingName('PEREZ JUAN CARLOS', null)).toBe('Perez Juan Carlos')
    expect(greetingName("D'ANGELO  MARIA", '  ')).toBe("D'Angelo Maria")
  })
})

describe('noticeParams and renderNotice', () => {
  const data = {
    organizationName: 'Seguros del Litoral',
    holderName: 'PEREZ JUAN',
    clientFirstName: 'JUAN',
    certificateNumber: '1234567',
    installmentNumber: 2,
    dueDate: new Date('2026-09-28T00:00:00.000Z'),
    amount: 90315,
    reason: 'FALTA DE FONDOS',
  }
  const [first, current] = REJECTION_TEMPLATE.versions

  it("names the sender's organization in the current text", () => {
    const params = noticeParams(data)
    expect(params).toEqual([
      'Juan',
      'Seguros del Litoral',
      '2',
      '1234567',
      '28/09/2026',
      '90.315',
      'falta de fondos en la cuenta',
    ])
    expect(renderNotice(params)).toBe(
      'Hola Juan, te escribimos de Seguros del Litoral, tu productor de seguros. Triunfo Seguros nos informó ' +
        'que no se pudo cobrar la cuota 2 de tu póliza 1234567 (vencimiento 28/09/2026, importe $90.315) por ' +
        'falta de fondos en la cuenta. Para que tu cobertura no quede suspendida, respondé este mensaje y te ' +
        'ayudamos a regularizar el pago.',
    )
    expect(current.name).toBe('aviso_rechazo_pago_v2')
  })

  it('still fills the first text, which only the first organization has', () => {
    const params = noticeParams(data, first)
    expect(params).toEqual(['Juan', '2', '1234567', '28/09/2026', '90.315', 'falta de fondos en la cuenta'])
    expect(renderNotice(params, first)).toBe(
      'Hola Juan, te escribimos de JP Management Group, tu productor de seguros. Triunfo Seguros nos informó ' +
        'que no se pudo cobrar la cuota 2 de tu póliza 1234567 (vencimiento 28/09/2026, importe $90.315) por ' +
        'falta de fondos en la cuenta. Para que tu cobertura no quede suspendida, respondé este mensaje y te ' +
        'ayudamos a regularizar el pago.',
    )
  })

  it('keeps the cents when there are some', () => {
    const [, , , , , amount] = noticeParams({
      organizationName: 'Seguros del Litoral',
      holderName: 'PEREZ JUAN',
      certificateNumber: '1',
      installmentNumber: 1,
      dueDate: new Date('2026-09-01T00:00:00.000Z'),
      amount: 1234.5,
      reason: 'FALTA DE FONDOS',
    })
    expect(amount).toBe('1.234,50')
  })
})
