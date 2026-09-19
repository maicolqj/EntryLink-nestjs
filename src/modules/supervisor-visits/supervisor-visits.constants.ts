/**
 * Días sin check-in tras los cuales un supervisor pierde el acceso a un
 * complejo. Pasa cuando lo movieron a otra zona o dejó la empresa de
 * seguridad, y nadie se acuerda de retirarlo a mano.
 *
 * Lo usan el cron que retira el acceso y la consulta que le muestra a la
 * administración cuándo va a pasar: si cada uno tuviera su número, la fecha
 * que ve la administración no sería la real.
 */
export const SUPERVISOR_INACTIVITY_DAYS = 30;

/**
 * Fecha a partir de la cual el cron retira el acceso: días de inactividad
 * contados desde la última visita, o desde la aprobación si nunca vino.
 */
export function supervisorAutoRemovalAt(
  assignedAt: Date,
  lastCheckInAt: Date | null,
): Date {
  const from = lastCheckInAt ?? assignedAt;
  return new Date(
    from.getTime() + SUPERVISOR_INACTIVITY_DAYS * 24 * 60 * 60 * 1000,
  );
}
