/**
 * Días sin check-in tras los cuales un supervisor pierde el acceso a un
 * complejo, si el complejo no configuró otro plazo
 * (`residential_complexes.supervisor_inactivity_days`). Pasa cuando lo movieron
 * a otra zona o dejó la empresa de seguridad, y nadie se acuerda de retirarlo.
 */
export const DEFAULT_SUPERVISOR_INACTIVITY_DAYS = 30;

/**
 * Fecha a partir de la cual el cron retira el acceso: el plazo del complejo
 * contado desde la última visita, o desde la aprobación si nunca vino.
 *
 * El cron y la consulta que le muestra la fecha a la administración usan esta
 * misma regla: si cada uno tuviera la suya, la fecha mostrada no sería la real.
 */
export function supervisorAutoRemovalAt(
  assignedAt: Date,
  lastCheckInAt: Date | null,
  inactivityDays: number = DEFAULT_SUPERVISOR_INACTIVITY_DAYS,
): Date {
  const from = lastCheckInAt ?? assignedAt;
  return new Date(from.getTime() + inactivityDays * 24 * 60 * 60 * 1000);
}
