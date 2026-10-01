import { MatterCategory } from './dto/list-novedades.dto'

/** Conservative rules: explicit customer requests only; unknown stays reviewable. */
export function classifyMatter(reason?: string): MatterCategory {
  const text = (reason ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  if (
    !/\bno (?:quiero|deseo|necesito) (?:dar(?:me)? de baja|cancelar)\b/.test(text) &&
    /\b(dar(?:me)? de baja|bajarme (?:del |de mi )?(?:seguro|poliza)|baja (?:de |del |mi |el |la )?(?:seguro|poliza)|cancelar (?:mi |el |la )?(?:seguro|poliza)|quiero (?:la )?baja)\b/.test(
      text,
    )
  )
    return MatterCategory.BAJA
  if (/\b(pago|pagos|pagar|pague|cobranza|deuda|cuota|cuotas|comprobante|transferencia|debito|cupon)\b/.test(text))
    return MatterCategory.PAGOS
  if (/\b(cotizar|cotizacion|presupuesto|contratar|contratacion)\b/.test(text)) return MatterCategory.COTIZACION
  if (/\b(siniestro|choque|accidente|denuncia)\b/.test(text)) return MatterCategory.SINIESTRO
  if (/\b(documentacion|documentos|certificado|poliza|cambiar|modificar|corregir|domicilio)\b/.test(text))
    return MatterCategory.DOCUMENTOS
  return MatterCategory.OTHER
}
