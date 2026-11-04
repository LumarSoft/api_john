import { blockedClaimReasonFromText } from './blocked-claim'

describe('blockedClaimReasonFromText', () => {
  it('reads each reason the bot writes since 2026-10-05', () => {
    expect(
      blockedClaimReasonFromText('Denuncia de siniestro no registrada: el cliente no tiene pólizas vigentes.'),
    ).toBe('NO_POLICY')
    expect(
      blockedClaimReasonFromText('Denuncia de siniestro no registrada: la póliza 9001 figura con un cobro rechazado.'),
    ).toBe('REJECTED_PAYMENT')
    expect(
      blockedClaimReasonFromText(
        'Denuncia de siniestro no registrada: la póliza 9001 figura con saldo vencido impago.',
      ),
    ).toBe('OVERDUE_INSTALLMENTS')
  })

  it('reads the last stopped claim of a request other messages were added to', () => {
    const merged =
      'Pidió hablar con un asesor.\n\nDenuncia de siniestro no registrada: el cliente no tiene pólizas vigentes.' +
      '\n\nDenuncia de siniestro no registrada: la póliza 9001 figura con un cobro rechazado.'
    expect(blockedClaimReasonFromText(merged)).toBe('REJECTED_PAYMENT')
  })

  it('ignores any other request, even one about a rejected payment', () => {
    expect(blockedClaimReasonFromText('Me rechazaron el pago de la cuota, ¿cómo pago?')).toBeNull()
    expect(blockedClaimReasonFromText('Quiero denunciar un siniestro')).toBeNull()
    expect(blockedClaimReasonFromText(null)).toBeNull()
  })
})
