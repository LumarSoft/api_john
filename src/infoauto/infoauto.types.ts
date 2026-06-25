// The catalog/vehicle line a quote belongs to. Drives both the InfoAuto catalog
// (cars vs motorcycles) and the Triunfo Articulo code (458 auto / 481 moto).
export enum VehicleType {
  AUTO = 'AUTO',
  MOTO = 'MOTO',
}

// Public route segment (e.g. /cotizador/auto, /infoauto/moto/brands) → internal enum
export const VEHICLE_TYPE_PARAMS = ['auto', 'moto'] as const
export type VehicleTypeParam = (typeof VEHICLE_TYPE_PARAMS)[number]

export function vehicleTypeFromParam(param: VehicleTypeParam): VehicleType {
  return param === 'moto' ? VehicleType.MOTO : VehicleType.AUTO
}
