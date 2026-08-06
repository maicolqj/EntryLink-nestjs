import { Injectable, Logger } from '@nestjs/common';

import { SocketService }        from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent }          from '../../../core/infrastructure/socket/socket.events';
import { PanicDeliveryChannel } from '../enums/panic-delivery-channel.enum';
import {
  PanicChannel,
  PanicChannelContext,
  PanicChannelResult,
} from './panic-channel.interface';

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

  constructor(private readonly socketService: SocketService) {}

  isAvailable(): boolean {
    return true;
  }

  unavailableReason(): string {
    return '';
  }

  async send(ctx: PanicChannelContext): Promise<PanicChannelResult> {
    try {
      this.socketService.emitToComplex(ctx.alert.complexId, SocketEvent.PANIC_ALERT_NEW, {
        complexId:        ctx.alert.complexId,
        alertId:          ctx.alert.id,
        unitId:           ctx.alert.unitId,
        triggeredBy:      ctx.alert.triggeredByUserId,
        triggeredByLabel: ctx.alert.triggeredByLabel,
        escalationLevel:  ctx.escalationLevel,
      });
      // Sin destinatario individual: se emite a la sala del complejo, así que no
      // hay forma de contar cuántos navegadores lo recibieron.
      return { reached: 1 };
    } catch (err) {
      const message = (err as Error)?.message ?? 'error desconocido';
      this.logger.error(`Socket falló para la alerta ${ctx.alert.id}: ${message}`);
      return { reached: 0, skippedReason: message };
    }
  }
}
