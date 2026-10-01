import 'reflect-metadata'
import { matterBrief } from './matter-brief'

const pending = { category: 'other', status: 'pending', type: 'handoff', body: null, refId: 7 }

describe('matterBrief', () => {
  it.each(['baja', 'pagos', 'cotizacion', 'siniestro', 'documentos', 'other'])(
    'provides a review action for %s without resolving the request',
    category => {
      const result = matterBrief({ ...pending, category, body: 'Pedido del cliente' })
      expect(result.summary).toBe('Pedido del cliente')
      expect(result.nextAction).toBeTruthy()
      expect(result.outcome).toContain('pendiente')
    },
  )
  it('shows the absence of a reason rather than inventing one', () => {
    expect(matterBrief(pending).summary).toContain('No se registró el motivo')
  })
  it('keeps the original request intact while producing a bounded excerpt', () => {
    const matter = { ...pending, body: 'a'.repeat(1000) }
    expect(matterBrief(matter).summary).toHaveLength(281)
    expect(matter.body).toHaveLength(1000)
  })
  it('does not assert the policy has been cancelled', () => {
    expect(matterBrief({ ...pending, category: 'baja', type: 'baja_poliza' }).outcome).toBe(
      'Solicitud recibida; la baja requiere gestión',
    )
  })
  it('does not offer more work after manual resolution', () => {
    expect(matterBrief({ ...pending, status: 'resolved' })).toMatchObject({
      nextAction: null,
      outcome: 'Marcado como resuelto por el equipo',
    })
  })
  it('distinguishes an invalid historical reference from a registered claim', () => {
    expect(matterBrief({ ...pending, refId: 0, type: 'siniestro' })).toMatchObject({
      outcome: 'Referencia del pedido pendiente de revisión',
    })
  })
  it('reflects manual category and status changes', () => {
    const before = matterBrief(pending)
    const after = matterBrief({ ...pending, category: 'pagos', status: 'in_progress' })
    expect(after.nextAction).not.toBe(before.nextAction)
    expect(after.outcome).toBe('En atención por el equipo')
  })
})
