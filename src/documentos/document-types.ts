// How each Triunfo document code is shown to the client, most requested first.
// Names fit a WhatsApp list row (24 characters).
const DOCUMENT_TYPES: Record<string, { name: string; order: number }> = {
  '1050': { name: 'Tarjeta verde (Mercosur)', order: 1 },
  '1000': { name: 'Certificado de cobertura', order: 2 },
  '1040': { name: 'Constancia de pago', order: 3 },
  '1060': { name: 'Cuponera de pago', order: 4 },
  '1020': { name: 'Póliza', order: 5 },
  '1030': { name: 'Cláusulas', order: 6 },
}

const MAX_NAME_LENGTH = 24

/** Display name of a document: ours for the known codes, Triunfo's otherwise. */
export function documentName(code: string, triunfoName: string): string {
  return DOCUMENT_TYPES[code]?.name ?? (triunfoName.trim().slice(0, MAX_NAME_LENGTH) || 'Documento')
}

/** Sort position of a document; unknown codes go last. */
export function documentOrder(code: string): number {
  return DOCUMENT_TYPES[code]?.order ?? Number.MAX_SAFE_INTEGER
}

/** "Tarjeta verde (Mercosur) - AB123CD.pdf": what the client sees in WhatsApp. */
export function documentFilename(name: string, reference: string): string {
  const safe = `${name} - ${reference}`
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${safe}.pdf`
}
