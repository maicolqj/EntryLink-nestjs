import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';
import { MaintenanceTicketStatus } from '../enums/maintenance-ticket-status.enum';
import { MaintenanceLocationType } from '../enums/maintenance-location-type.enum';

/** Estados en los que el ticket todavía es trabajo pendiente de alguien. */
export const OPEN_TICKET_STATUSES = [
  MaintenanceTicketStatus.NEW,
  MaintenanceTicketStatus.TRIAGED,
  MaintenanceTicketStatus.ASSIGNED,
  MaintenanceTicketStatus.IN_PROGRESS,
  MaintenanceTicketStatus.ON_HOLD,
];

/** Estados en los que el ticket ya no vuelve al tablero. */
export const FINAL_TICKET_STATUSES = [
  MaintenanceTicketStatus.CLOSED,
  MaintenanceTicketStatus.REJECTED,
  MaintenanceTicketStatus.DUPLICATE,
];

/**
 * Movimientos que la administración puede hacer arrastrando la tarjeta.
 *
 * Resolver, cerrar, rechazar, reabrir y marcar duplicado NO están aquí: cada
 * uno exige algo más —evidencia, motivo, quién confirma— y tiene su propia
 * mutation. Un tablero que deje saltar de NEW a CLOSED de un tirón convierte
 * todo el trámite en decoración.
 */
export const ALLOWED_MANUAL_TRANSITIONS: Record<
  MaintenanceTicketStatus,
  MaintenanceTicketStatus[]
> = {
  [MaintenanceTicketStatus.NEW]: [MaintenanceTicketStatus.TRIAGED],
  [MaintenanceTicketStatus.TRIAGED]: [MaintenanceTicketStatus.ASSIGNED],
  [MaintenanceTicketStatus.ASSIGNED]: [
    MaintenanceTicketStatus.IN_PROGRESS,
    MaintenanceTicketStatus.ON_HOLD,
  ],
  [MaintenanceTicketStatus.IN_PROGRESS]: [MaintenanceTicketStatus.ON_HOLD],
  [MaintenanceTicketStatus.ON_HOLD]: [
    MaintenanceTicketStatus.IN_PROGRESS,
    MaintenanceTicketStatus.ASSIGNED,
  ],
  [MaintenanceTicketStatus.RESOLVED]: [],
  [MaintenanceTicketStatus.CLOSED]: [],
  [MaintenanceTicketStatus.REJECTED]: [],
  [MaintenanceTicketStatus.DUPLICATE]: [],
};

/**
 * ¿El complejo tiene encendido el módulo de mantenimiento?
 *
 * Misma regla que mascotas, finanzas y votaciones: la fuente es
 * `enabledModules`, y lista nula o vacía significa "todos". No se crea una
 * columna propia — la de mascotas nació en `false`, nadie la escribía y el
 * módulo quedaba muerto con la pantalla visible.
 */
export function isMaintenanceModuleEnabled(complex: {
  enabledModules?: string[] | null;
}): boolean {
  const modules = complex?.enabledModules;
  return (
    !modules ||
    modules.length === 0 ||
    modules.includes(ComplexModule.MANTENIMIENTO)
  );
}

/**
 * ¿El punto se puede pintar en el mapa?
 *
 * Un tag pegado en la pared y una zona común ya modelada son ubicaciones
 * levantadas con calma; el GPS del celular solo vale si el propio dispositivo
 * declara poco error. Sin este filtro el mapa manda al técnico a la torre
 * equivocada con toda la seguridad del mundo.
 */
export function isPreciseLocation(
  locationType: MaintenanceLocationType,
  gpsAccuracyMeters: number | null | undefined,
  threshold: number,
): boolean {
  if (
    locationType === MaintenanceLocationType.TAG ||
    locationType === MaintenanceLocationType.AMENITY
  ) {
    return true;
  }

  if (locationType === MaintenanceLocationType.TREE) return false;

  // Un GPS que ni siquiera reporta su error no es de fiar: los que miden bien
  // lo informan siempre.
  if (gpsAccuracyMeters == null) return false;

  return gpsAccuracyMeters <= threshold;
}

/** Lee un booleano que pudo llegar como texto desde multipart. */
export function readOptionalBoolean(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw === 1;
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim().toLowerCase();
  return text === 'true' || text === '1';
}
