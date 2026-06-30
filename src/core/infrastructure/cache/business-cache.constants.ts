/**
 * Claves y TTLs de caché para módulos de negocio.
 *
 * Convención de claves:
 *   {prefix}:{complexId}:{...params}
 *
 * El complexId siempre va primero tras el prefix, lo que permite borrar
 * todo el caché de un módulo para un complejo con un único SCAN:
 *   cacheService.deleteByPrefix(BK.unit.prefix(complexId))
 */

export const BK = {

  /** Complejo residencial */
  complex: {
    one:    (id: string) => ({ prefix: 'cpx', key: id }),
    prefix: (id: string) => `cpx:${id}`,
    TTL: 120,   // 2 min — se llama en cada operación como auth check
  },

  /** Torres / Edificios */
  building: {
    list:   (complexId: string, page: number, limit: number) =>
              ({ prefix: 'bld', key: `${complexId}:${page}:${limit}` }),
    prefix: (complexId: string) => `bld:${complexId}:`,
    TTL: 300,   // 5 min
  },

  /** Unidades (apartamentos / casas) */
  unit: {
    list:   (complexId: string, page: number, limit: number, buildingId = 'all', status = 'all', search = 'all') =>
              ({ prefix: 'unit', key: `${complexId}:${buildingId}:${status}:${search}:${page}:${limit}` }),
    all:    (complexId: string) => ({ prefix: 'unit', key: `${complexId}:all` }),
    prefix: (complexId: string) => `unit:${complexId}:`,
    TTL: 300,   // 5 min
  },

  /** Residentes */
  resident: {
    stats:  (complexId: string) => ({ prefix: 'res', key: `${complexId}:stats` }),
    list:   (complexId: string, page: number, limit: number, filterKey: string) =>
              ({ prefix: 'res', key: `${complexId}:list:${page}:${limit}:${filterKey}` }),
    prefix: (complexId: string) => `res:${complexId}:`,
    TTL: 120,   // 2 min — cambia con frecuencia
  },

  /** Vehículos — consulta de placa en tiempo real */
  vehicle: {
    plate:  (complexId: string, plate: string) =>
              ({ prefix: 'veh', key: `${complexId}:plate:${plate}` }),
    list:   (complexId: string, page: number, limit: number, filterKey: string) =>
              ({ prefix: 'veh', key: `${complexId}:list:${page}:${limit}:${filterKey}` }),
    prefix: (complexId: string) => `veh:${complexId}:`,
    TTL_PLATE: 120,  // 2 min — seguridad requiere datos frescos
    TTL_LIST:  180,  // 3 min
  },

  /** Paquetes pendientes de retiro */
  pkg: {
    pending: (complexId: string, unitId: string) =>
               ({ prefix: 'pkg', key: `${complexId}:pending:${unitId}` }),
    list:    (complexId: string, page: number, limit: number, filterKey: string) =>
               ({ prefix: 'pkg', key: `${complexId}:list:${page}:${limit}:${filterKey}` }),
    prefix:  (complexId: string) => `pkg:${complexId}:`,
    TTL: 60,    // 1 min — dato operativo de recepción
  },

  /** Finanzas */
  finance: {
    config:     (complexId: string) => ({ prefix: 'fin', key: `${complexId}:cfg` }),
    feeConfigs: (complexId: string) => ({ prefix: 'fin', key: `${complexId}:fees` }),
    categories: (complexId: string) => ({ prefix: 'fin', key: `${complexId}:cats` }),
    prefix:     (complexId: string) => `fin:${complexId}:`,
    TTL_CONFIG: 3600,  // 1 hora — rara vez cambia
    TTL_FEES:   600,   // 10 min
    TTL_CATS:   600,   // 10 min
  },

  /** Números especiales de emergencia */
  specialNumber: {
    list:   (complexId: string) => ({ prefix: 'sn', key: complexId }),
    global: ()                  => ({ prefix: 'sn', key: 'global' }),
    prefix: (complexId: string) => `sn:${complexId}`,
    TTL: 3600,  // 1 hora — estables
  },
} as const;

/** Genera una clave compacta a partir de un objeto de filtros */
export function filterKey(filters: object): string {
  if (!filters || Object.keys(filters).length === 0) return 'none';
  return Object.entries(filters as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('|') || 'none';
}
