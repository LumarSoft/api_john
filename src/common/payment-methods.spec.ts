import { isVisiblePaymentMethod, paymentMethodLabel } from './payment-methods'

describe('payment methods', () => {
  it('names the card and cash prices the way the client asked', () => {
    expect(paymentMethodLabel('1', 'Débito Automático')).toBe('Con tarjeta')
    expect(paymentMethodLabel(' 9 ', 'Plan de Pago')).toBe('En efectivo')
  })

  it('keeps Contado hidden and unknown methods with their own name', () => {
    expect(isVisiblePaymentMethod('6')).toBe(false)
    expect(paymentMethodLabel('7', 'Otra')).toBe('Otra')
  })
})
