import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';

import { PanicDeliveryChannel } from '../enums/panic-delivery-channel.enum';
import {
  PanicChannel,
  PanicChannelContext,
  PanicChannelResult,
} from './panic-channel.interface';
import { NotificationsService } from '../services/notifications.service';

/**
 * Reemite la alerta al dashboard de portería.
 *
 * El navegador de la portería está abierto todo el día y no sufre ninguna de las
 * restricciones de OEM que afectan al celular, así que es el canal más fiable
 * que tenemos — por eso se repite en cada nivel y no solo al inicio.
 */
@Injectable()
export class SocketPanicChannel implements PanicChannel {
  readonly channel = PanicDeliveryChannel.SOCKET;
  private readonly logger = new Logger(SocketPanicChannel.name);

  constructor(
    // forwardRef: NotificationsService es quien construye los canales al escalar,
    // así que la dependencia es circular por diseño. Se emite por su método para
    // que la escalada también lleve la lista de quién debe ignorar el pánico.
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
    try {
      await this.notificationsService.emitPanicNew(ctx.alert.complexId, {
        complexId: ctx.alert.complexId,
        alertId: ctx.alert.id,
        unitId: ctx.alert.unitId,
        triggeredBy: ctx.alert.triggeredByUserId,
        triggeredByLabel: ctx.alert.triggeredByLabel,
        escalationLevel: ctx.escalationLevel,
      });
      // Sin destinatario individual: se emite a la sala del complejo, así que no
      // hay forma de contar cuántos navegadores lo recibieron.
      return { reached: 1 };
    } catch (err) {
      const message = (err as Error)?.message ?? 'error desconocido';
      this.logger.error(
        `Socket falló para la alerta ${ctx.alert.id}: ${message}`,
      );
      return { reached: 0, skippedReason: message };
    }
  }
}
