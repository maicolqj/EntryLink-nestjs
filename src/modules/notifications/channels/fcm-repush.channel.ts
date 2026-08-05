import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';

import { PanicDeliveryChannel }   from '../enums/panic-delivery-channel.enum';
import { NotificationType }       from '../enums/notification-type.enum';
import { NotificationPriority }   from '../enums/notification-priority.enum';
import { NotificationsService }   from '../services/notifications.service';
import {
  PanicChannel,
  PanicChannelContext,
  PanicChannelResult,
} from './panic-channel.interface';

/**
 * Reintenta el push a los mismos destinatarios.
 *
 * No es redundante: un teléfono sin red o en Doze profundo en t=0 puede estar
 * alcanzable 15 segundos después, y FCM descarta el mensaje original por el TTL
 * corto que lleva el pánico. Repetir es la forma más barata de ganar entregas
 * antes de gastar canales más caros.
 *
 * Reusa dispatchPushOnly a propósito: no persiste una notificación nueva, así
 * que el buzón del usuario no se llena de copias del mismo incidente.
 */
@Injectable()
export class FcmRepushPanicChannel implements PanicChannel {
  readonly channel = PanicDeliveryChannel.FCM;
  private readonly logger = new Logger(FcmRepushPanicChannel.name);

  constructor(
    // forwardRef: NotificationsService es quien construye los canales al escalar,
    // así que la dependencia es circular por diseño.
    @Inject(forwardRef(() => NotificationsService))
    private readonly notificationsService: NotificationsService,
  ) {}

  isAvailable(): boolean {
    return true;
  }

  unavailableReason(): string {
    return '';
  }

  async send(ctx: PanicChannelContext): Promise<PanicChannelResult> {
    if (ctx.userIds.length === 0) return { reached: 0, skippedReason: 'sin destinatarios' };

    try {
      await this.notificationsService.dispatchPushOnly(ctx.userIds, {
        complexId:       ctx.alert.complexId,
        userIds:         ctx.userIds,
        type:            NotificationType.PANIC_ALERT,
        priority:        NotificationPriority.URGENT,
        title:           ctx.title,
        body:            ctx.body,
        createdByUserId: ctx.alert.triggeredByUserId,
        panicAlertId:    ctx.alert.id,
        metadata:        { triggeredByLabel: ctx.alert.triggeredByLabel ?? '' },
      });
      return { reached: ctx.userIds.length };
    } catch (err) {
      const message = (err as Error)?.message ?? 'error desconocido';
      this.logger.error(`Re-push falló para la alerta ${ctx.alert.id}: ${message}`);
      return { reached: 0, skippedReason: message };
    }
  }
}
