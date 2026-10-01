import 'reflect-metadata'
import { classifyMatter } from './classify-matter'

describe('classifyMatter', () => {
  it.each([
    ['Quiero dar de baja mi póliza', 'baja'],
    ['Quiero cancelar mi seguro', 'baja'],
    ['Ya pagué, adjunto comprobante', 'pagos'],
    ['Necesito cotización de mi moto', 'cotizacion'],
    ['Consultar un siniestro', 'siniestro'],
    ['Modificar domicilio de mi póliza', 'documentos'],
    ['Necesito un asesor', 'other'],
    ['El precio está bajo', 'other'],
    ['Quiero cancelar una cuota', 'pagos'],
    ['Quiero bajarme del seguro', 'baja'],
    ['No quiero dar de baja el seguro', 'other'],
  ])('classifies %s as %s', (reason, expected) => expect(classifyMatter(reason)).toBe(expected))
})
