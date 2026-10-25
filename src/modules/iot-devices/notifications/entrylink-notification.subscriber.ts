import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource, EntitySubscriberInterface, InsertEvent } from 'typeorm';

import { Notification } from '../../notifications/entities/notification.entity';
import {
  DEVICE_NOTIFY_JOBS,
  DEVICE_NOTIFY_QUEUE,
  EntrylinkNotificationJob,
  IOT_JOB_OPTIONS,
} from '../queues/iot-queues.constants';

/**
 * Engancha los avisos de EntryLink sin modificar el módulo de notificaciones:
 * escucha cada INSERT en `notifications` (paquete, pánico, comunicado…) y
 * encola su reenvío a los aparatos. Todas las notificaciones se guardan con
 * `notifRepo.save()`, que dispara este suscriptor.
 *
 * Se registra a mano en el DataSource al iniciar ESTE módulo (solo con
 * IOT_ENABLED) y se quita al cerrarlo. No hace nada en la transacción del
 * INSERT salvo encolar (Redis); si Redis falla, se registra y la notificación
 * original sigue su curso intacta.
 */
@Injectable()
export class EntrylinkNotificationSubscriber
  implements
    EntitySubscriberInterface<Notification>,
    OnModuleInit,
    OnModuleDestroy
{
  private readonly logger = new Logger(EntrylinkNotificationSubscriber.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(DEVICE_NOTIFY_QUEUE)
    private readonly queue: Queue<EntrylinkNotificationJob>,
  ) {}

  onModuleInit(): void {
    if (!this.dataSource.subscribers.includes(this))
      this.dataSource.subscribers.push(this);
  }

  onModuleDestroy(): void {
    const i = this.dataSource.subscribers.indexOf(this);
    if (i >= 0) this.dataSource.subscribers.splice(i, 1);
  }

  listenTo(): typeof Notification {
    return Notification;
  }

  afterInsert(event: InsertEvent<Notification>): void {
    const n = event.entity;
    if (!n?.id || !n.complexId) return;
    const job: EntrylinkNotificationJob = {
      notificationId: n.id,
      type: String(n.type),
      title: n.title,
      complexId: n.complexId,
      recipientUserId: n.recipientUserId ?? null,
      isBroadcast: !!n.isBroadcast,
      targetRoles: n.targetRoles ?? [],
    };
    // Sin await: no se alarga la transacción de quien creó la notificación
    this.queue
      .add(DEVICE_NOTIFY_JOBS.FROM_ENTRYLINK, job, {
        ...IOT_JOB_OPTIONS,
        jobId: `notif-${n.id}`,
      })
      .catch((e: Error) =>
        this.logger.warn(
          `[notify] no se pudo encolar ${n.type} ${n.id}: ${e.message}`,
        ),
      );
  }
}
