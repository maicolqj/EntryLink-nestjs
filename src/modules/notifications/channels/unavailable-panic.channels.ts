import { Injectable, Logger } from '@nestjs/common';

import { PanicDeliveryChannel } from '../enums/panic-delivery-channel.enum';
import {
  PanicChannel,
  PanicChannelContext,
  PanicChannelResult,
} from './panic-channel.interface';

/**
 * Canales declarados en el diseño pero sin proveedor conectado todavía.
 *
 * Existen a propósito en vez de omitirse: el escalamiento los pide, registra por
 * qué no salieron y sigue con el siguiente. Así el hueco aparece en la auditoría
 * y en Bull Board —"nivel 2 no pudo llamar al supervisor"— en lugar de quedar
 * como un nivel que silenciosamente no hace nada. Conectarlos es reemplazar el
 * cuerpo de `send` y devolver true en `isAvailable`.
 */
abstract class UnavailablePanicChannel implements PanicChannel {
  protected readonly logger = new Logger(this.constructor.name);

  abstract readonly channel: PanicDeliveryChannel;

  isAvailable(): boolean {
    return false;
  }

  abstract unavailableReason(): string;

  async send(ctx: PanicChannelContext): Promise<PanicChannelResult> {
    const reason = this.unavailableReason();
    this.logger.warn(
      `Canal ${this.channel} no disponible en nivel ${ctx.escalationLevel} ` +
      `(alerta ${ctx.alert.id}): ${reason}`,
    );
    return { reached: 0, skippedReason: reason };
  }
}

/**
 * WhatsApp existe como servicio (Cloud API de Meta) pero solo sabe enviar las
 * plantillas de autenticación. Una alerta de pánico necesita su propia plantilla
 * aprobada por Meta, y la cuenta está en revisión.
 */
@Injectable()
export class WhatsAppPanicChannel extends UnavailablePanicChannel {
  readonly channel = PanicDeliveryChannel.WHATSAPP;

  unavailableReason(): string {
    return 'Falta plantilla de pánico aprobada por Meta; la WABA sigue en revisión';
  }
}

@Injectable()
export class SmsPanicChannel extends UnavailablePanicChannel {
  readonly channel = PanicDeliveryChannel.SMS;

  unavailableReason(): string {
    return 'No hay proveedor de SMS contratado';
  }
}

@Injectable()
export class VoicePanicChannel extends UnavailablePanicChannel {
  readonly channel = PanicDeliveryChannel.VOICE;

  unavailableReason(): string {
    return 'No hay proveedor de voz contratado';
  }
}
