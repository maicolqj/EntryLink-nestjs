import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BK } from '../../../core/infrastructure/cache/business-cache.constants';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';
import { SocketService } from '../../../core/infrastructure/socket/socket.service';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { CommunityAccess } from '../dto/responses/community-access.response';
import { SubscriptionReminder } from '../entities/subscription-reminder.entity';
import { formatBogotaDate } from '../utils/format-date';
import {
  RESIDENT_NOTICE_DAYS,
  addDays,
  earliestCutDate,
  nextCutStep,
  parseCutMode,
} from '../utils/subscription-status';
import {
  NOTIFIED_STATUSES,
  SubscriptionRemindersService,
} from './subscription-reminders.service';
import { SubscriptionsService } from './subscriptions.service';

const NOTICE_COUNT = RESIDENT_NOTICE_DAYS.length;

/**
 * Avisa a la comunidad y marca el corte de los conjuntos que no renovaron.
 *
 * El corte nunca se calcula solo por la fecha: exige tres avisos registrados
 * en `subscription_reminders` con sus intervalos. Así un conjunto que ya
 * llevaba meses vencido cuando se activó esto también recibe sus tres avisos.
 *
 * Los avisos de cada modo son distintos porque prometen cosas distintas: los de
 * `access` dicen que el pánico sigue, así que no autorizan a apagarlo.
 */
@Injectable()
export class SubscriptionCutService {
  private readonly logger = new Logger(SubscriptionCutService.name);

  constructor(
    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,
    @InjectRepository(SubscriptionReminder)
    private readonly reminderRepo: Repository<SubscriptionReminder>,
    private readonly remindersService: SubscriptionRemindersService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly notificationsService: NotificationsService,
    private readonly cacheService: CacheService,
    private readonly socketService: SocketService,
    private readonly configService: ConfigService,
  ) {}

  /** Devuelve cuántos conjuntos avanzaron un paso. */
  async run(now: Date = new Date()): Promise<number> {
    const mode = parseCutMode(
      this.configService.get<string>('SUBSCRIPTION_CUT_MODE'),
    );
    if (mode === 'off') return 0;

    const withPanic = mode === 'access_and_panic';
    const pendingColumn = withPanic
      ? 'c.subscription_panic_cut_at'
      : 'c.subscription_access_cut_at';

    // Un día de holgura: el paso exacto lo decide `nextCutStep` por calendario.
    const complexes = await this.complexRepo
      .createQueryBuilder('c')
      .where('c.deleted_at IS NULL')
      .andWhere('c.status IN (:...statuses)', { statuses: NOTIFIED_STATUSES })
      .andWhere('c.subscription_ends_at <= :limit', {
        limit: addDays(now, -(RESIDENT_NOTICE_DAYS[0] - 1)),
      })
      .andWhere(`${pendingColumn} IS NULL`)
      .getMany();

    let advanced = 0;
    for (const complex of complexes) {
      try {
        if (await this.advance(complex, withPanic, now)) advanced++;
      } catch (err) {
        this.logger.error(
          `Corte de suscripción fallido para ${complex.id}: ${(err as Error).message}`,
        );
      }
    }
    return advanced;
  }

  /** Lo que la app de la comunidad necesita saber del corte de su conjunto. */
  async communityAccess(
    complexId: string,
    now: Date = new Date(),
  ): Promise<CommunityAccess> {
    const open = { accessCut: false, panicAvailable: true, cutAt: null };
    const mode = parseCutMode(
      this.configService.get<string>('SUBSCRIPTION_CUT_MODE'),
    );
    if (mode === 'off') return open;

    const complex = await this.complexRepo.findOne({
      where: { id: complexId },
    });
    if (!complex?.subscriptionEndsAt) return open;

    const withPanic = mode === 'access_and_panic';
    const panicAvailable = !(withPanic && complex.subscriptionPanicCutAt);
    if (complex.subscriptionAccessCutAt) {
      return {
        accessCut: true,
        panicAvailable,
        cutAt: complex.subscriptionAccessCutAt,
      };
    }

    const endsAt = new Date(complex.subscriptionEndsAt);
    const sent = await this.sentNotices(
      complexId,
      endsAt,
      withPanic ? 'PANIC' : 'ACCESS',
    );
    if (!sent.some(Boolean)) return open;
    return {
      accessCut: false,
      panicAvailable,
      cutAt: earliestCutDate(endsAt, sent, now),
    };
  }

  private async sentNotices(
    complexId: string,
    endsAt: Date,
    prefix: string,
  ): Promise<(Date | null)[]> {
    const rows = await this.reminderRepo.find({
      where: { complexId, endsAt },
    });
    return Array.from({ length: NOTICE_COUNT }, (_, i) => {
      const row = rows.find((r) => r.milestone === `${prefix}_N${i + 1}`);
      return row ? new Date(row.sentAt) : null;
    });
  }

  private async advance(
    complex: ResidentialComplex,
    withPanic: boolean,
    now: Date,
  ): Promise<boolean> {
    const endsAt = new Date(complex.subscriptionEndsAt);
    const prefix = withPanic ? 'PANIC' : 'ACCESS';
    const sent = await this.sentNotices(complex.id, endsAt, prefix);

    const step = nextCutStep(endsAt, sent, now);
    if (!step) return false;

    if (step.kind === 'CUT') {
      return this.cut(complex, endsAt, prefix, withPanic, now);
    }

    const milestone = `${prefix}_N${step.index + 1}`;
    const claimed = await this.remindersService.claim(
      complex.id,
      endsAt,
      milestone,
    );
    if (!claimed) return false;

    try {
      await this.sendNotice(
        complex,
        earliestCutDate(endsAt, sent, now),
        withPanic,
        milestone,
      );
    } catch (err) {
      // Un aviso que no salió no puede contar como uno de los tres.
      await this.reminderRepo.delete({
        complexId: complex.id,
        endsAt,
        milestone,
      });
      throw err;
    }
    return true;
  }

  private async sendNotice(
    complex: ResidentialComplex,
    cutAt: Date,
    withPanic: boolean,
    milestone: string,
  ): Promise<void> {
    const roles = [ValidRoles.RESIDENT_ROL, ValidRoles.SECURITY_ROL];
    const userIds = await this.notificationsService.findUserIdsByRoles(
      complex.id,
      roles,
    );
    const date = formatBogotaDate(cutAt);
    const consequence = withPanic
      ? `Si no se renueva, desde el ${date} la app y el botón de pánico dejarán de funcionar. En una emergencia marca 123.`
      : `Si no se renueva, desde el ${date} la app dejará de funcionar para toda la comunidad. El botón de pánico seguirá activo.`;

    await this.notificationsService.notify({
      complexId: complex.id,
      userIds,
      type: NotificationType.COMPLEX_ALERT,
      priority: NotificationPriority.HIGH,
      title: 'Aviso importante de tu conjunto',
      body: `La administración de ${complex.name} no ha renovado la suscripción de EntryLink. ${consequence}`,
      entityId: complex.id,
      entityType: 'ResidentialComplex',
      isBroadcast: true,
      targetRoles: roles,
      metadata: {
        kind: 'SUBSCRIPTION_CUT_NOTICE',
        milestone,
        complexId: complex.id,
        cutAt: cutAt.toISOString(),
      },
    });
  }

  private async cut(
    complex: ResidentialComplex,
    endsAt: Date,
    prefix: string,
    withPanic: boolean,
    now: Date,
  ): Promise<boolean> {
    const claimed = await this.remindersService.claim(
      complex.id,
      endsAt,
      `${prefix}_CUT`,
    );
    if (!claimed) return false;

    await this.complexRepo.update(
      complex.id,
      withPanic
        ? {
            subscriptionAccessCutAt: complex.subscriptionAccessCutAt ?? now,
            subscriptionPanicCutAt: now,
          }
        : { subscriptionAccessCutAt: now },
    );
    await this.cacheService.delete({
      key: BK.complexSubscription.one(complex.id),
    });
    this.socketService.emitToComplex(
      complex.id,
      SocketEvent.COMPLEX_STATUS_CHANGED,
      {
        complexId: complex.id,
        status: complex.status,
        reason: null,
        suspendedAt: null,
      },
    );

    await this.subscriptionsService.notifyComplex({
      complexId: complex.id,
      type: NotificationType.SUBSCRIPTION_SUSPENDED,
      priority: NotificationPriority.HIGH,
      title: 'Servicio suspendido',
      body: 'La suscripción no se renovó y el servicio quedó suspendido para toda la comunidad. Renueva para restablecerlo de inmediato.',
      alsoSuperAdmins: {
        title: 'Corte por suscripción',
        body: `"${complex.name}" quedó con el servicio suspendido por no renovar.`,
      },
    });
    return true;
  }
}
