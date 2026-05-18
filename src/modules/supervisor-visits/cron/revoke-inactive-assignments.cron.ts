import { Injectable, Logger } from '@nestjs/common';
import { Cron }               from '@nestjs/schedule';
import { InjectRepository }   from '@nestjs/typeorm';
import { In, Repository }     from 'typeorm';

import { UserComplexAssignment, AssignmentStatus } from '../../users/entities/user-complex-assignment.entity';
import { ValidRoles }             from '../../roles/enums/valid-roles';
import { NotificationsService }   from '../../notifications/services/notifications.service';
import { NotificationType }       from '../../notifications/enums/notification-type.enum';
import { NotificationPriority }   from '../../notifications/enums/notification-priority.enum';

interface ExpiredRow {
  id:         string;
  user_id:    string;
  complex_id: string;
}

/**
 * Cron diario a las 02:00 AM (Bogotá) que revoca asignaciones de supervisores
 * que no han realizado check-in en un complejo durante 30 días consecutivos.
 *
 * Condición de revocación (cualquiera de las dos):
 *  1. La asignación tiene más de 30 días y nunca hubo un check-in.
 *  2. El último check-in registrado para ese supervisor+complejo fue hace más de 30 días.
 *
 * Tras la revocación el supervisor debe solicitar acceso nuevamente mediante
 * la mutación requestComplexAccess.
 */
@Injectable()
export class RevokeInactiveAssignmentsCron {
  private readonly logger = new Logger(RevokeInactiveAssignmentsCron.name);

  constructor(
    @InjectRepository(UserComplexAssignment)
    private readonly assignmentRepo: Repository<UserComplexAssignment>,

    private readonly notificationsService: NotificationsService,
  ) {}

  @Cron('0 2 * * *', { timeZone: 'America/Bogota' })
  async run(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);

    const expired: ExpiredRow[] = await this.assignmentRepo.manager.query(
      `SELECT a.id, a.user_id, a.complex_id
       FROM user_complex_assignments a
       WHERE a.role   = $1
         AND a.status = $2
         AND (
           (
             a.assigned_at < $3
             AND NOT EXISTS (
               SELECT 1 FROM supervisor_visits v
               WHERE v.supervisor_id = a.user_id
                 AND v.complex_id    = a.complex_id
             )
           )
           OR (
             (
               SELECT MAX(v.check_in_at)
               FROM supervisor_visits v
               WHERE v.supervisor_id = a.user_id
                 AND v.complex_id    = a.complex_id
             ) < $3
           )
         )`,
      [ValidRoles.SUPERVISOR_ROL, AssignmentStatus.ACTIVE, cutoff],
    );

    if (expired.length === 0) return;

    this.logger.log(
      `[RevokeInactiveAssignments] ${expired.length} asignación(es) a revocar por inactividad`,
    );

    const now = new Date();
    const ids  = expired.map(r => r.id);

    await this.assignmentRepo.update(
      { id: In(ids) },
      { status: AssignmentStatus.REMOVED, removedAt: now },
    );

    for (const row of expired) {
      void this.notificationsService
        .notify({
          complexId:  row.complex_id,
          userIds:    [row.user_id],
          type:       NotificationType.ACCESS_REVOKED_INACTIVITY,
          priority:   NotificationPriority.HIGH,
          title:      'Acceso revocado por inactividad',
          body:       'Tu asignación a este complejo fue revocada por no haber realizado check-in en los últimos 30 días. Para recuperar el acceso debes solicitar autorización nuevamente.',
          entityType: 'ACCESS_REQUEST',
          metadata:   {
            complexId: row.complex_id,
            revokedAt: now.toISOString(),
            reason:    'INACTIVITY_30_DAYS',
          },
        })
        .catch(err =>
          this.logger.warn(
            `Error al notificar revocación supervisor=${row.user_id} complejo=${row.complex_id}: ${err?.message}`,
          ),
        );
    }

    this.logger.log(
      `[RevokeInactiveAssignments] Revocación completada: ${expired.length} asignación(es)`,
    );
  }
}
