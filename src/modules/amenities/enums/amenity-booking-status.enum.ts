import { registerEnumType } from '@nestjs/graphql';

/**
 * Ciclo de vida de la reserva.
 *
 *   PENDING ─┬─> APPROVED ─┬─> CHECKED_IN ──> COMPLETED
 *            │             ├─> NO_SHOW        (venció sin ingreso)
 *            │             └─> CANCELLED
 *            ├─> REJECTED
 *            ├─> CANCELLED
 *            └─> EXPIRED   (el admin nunca respondió y llegó la hora)
 */
export enum AmenityBookingStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  CHECKED_IN = 'CHECKED_IN',
  COMPLETED = 'COMPLETED',
  NO_SHOW = 'NO_SHOW',
  EXPIRED = 'EXPIRED',
}

registerEnumType(AmenityBookingStatus, {
  name: 'AmenityBookingStatus',
  description: 'Estado de la reserva de zona común',
});

/**
 * Estados que ocupan cupo: cuentan contra `maxSimultaneousBookings` y contra
 * los límites por unidad. Un rechazo o una cancelación liberan la franja.
 */
export const ACTIVE_BOOKING_STATUSES: AmenityBookingStatus[] = [
  AmenityBookingStatus.PENDING,
  AmenityBookingStatus.APPROVED,
  AmenityBookingStatus.CHECKED_IN,
];

/**
 * Estados que consumen el cupo anual del consejo de administración. Una reserva
 * rechazada, cancelada o vencida lo devuelve: un error al pedirla no puede
 * quemarle el beneficio del año a quien ni siquiera llegó a usar la zona.
 */
export const COUNCIL_QUOTA_STATUSES: AmenityBookingStatus[] = [
  AmenityBookingStatus.PENDING,
  AmenityBookingStatus.APPROVED,
  AmenityBookingStatus.CHECKED_IN,
  AmenityBookingStatus.COMPLETED,
  AmenityBookingStatus.NO_SHOW,
];
