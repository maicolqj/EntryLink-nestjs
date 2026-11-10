import { Between, EntityManager, IsNull } from 'typeorm';

import { AmenityBooking } from '../../amenities/entities/amenity-booking.entity';
import { AmenityBookingStatus } from '../../amenities/enums/amenity-booking-status.enum';
import { PqrfStatus } from '../../pqrf/enums/pqrf-status.enum';
import { SubscriptionPause } from '../entities/subscription-pause.entity';
import { graceEndsAt, isAutomationPaused } from '../utils/subscription-status';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Si el cambio de vencimiento saca al conjunto de la pausa, deja constancia y
 * compensa lo que no pudo correr mientras estuvo pausado. Va dentro de la
 * transacción que cambia la fecha.
 *
 * - Los PQRF abiertos recuperan los días pausados: la administración estaba en
 *   solo lectura y no podía responderlos. Uno radicado durante la pausa solo
 *   recupera desde su radicación.
 * - Las reservas aprobadas que terminaron en la pausa quedan EXPIRED: como
 *   NO_SHOW sostendrían sanciones por algo que el barrido no pudo cerrar.
 *
 * Devuelve la pausa creada, o null si no había nada que reanudar.
 */
export async function recordResumeIfNeeded(
  manager: EntityManager,
  complexId: string,
  previousEndsAt: Date | null,
  newEndsAt: Date,
  now: Date,
): Promise<SubscriptionPause | null> {
  if (
    !previousEndsAt ||
    !isAutomationPaused(previousEndsAt, now) ||
    isAutomationPaused(newEndsAt, now)
  ) {
    return null;
  }

  const pausedAt = graceEndsAt(previousEndsAt);
  const inserted = await manager
    .createQueryBuilder()
    .insert()
    .into(SubscriptionPause)
    .values({
      complexId,
      pausedAt,
      resumedAt: now,
      days: Math.ceil((now.getTime() - pausedAt.getTime()) / DAY_MS),
      recurringCaughtUpAt: null,
    })
    .orIgnore()
    .returning(['id'])
    .execute();
  const created = (inserted.raw as { id: string }[])[0];
  if (!created) return null;

  await manager.query(
    `UPDATE pqrf_requests
        SET due_at = due_at + ($1::timestamptz - GREATEST($2::timestamptz, created_at))
      WHERE complex_id = $3
        AND status = ANY($4::text[])
        AND deleted_at IS NULL`,
    [now, pausedAt, complexId, [PqrfStatus.RADICADO, PqrfStatus.EN_TRAMITE]],
  );

  await manager.getRepository(AmenityBooking).update(
    {
      complexId,
      status: AmenityBookingStatus.APPROVED,
      endAt: Between(pausedAt, now),
      deletedAt: IsNull(),
    },
    { status: AmenityBookingStatus.EXPIRED },
  );

  return manager
    .getRepository(SubscriptionPause)
    .findOneByOrFail({ id: created.id });
}
