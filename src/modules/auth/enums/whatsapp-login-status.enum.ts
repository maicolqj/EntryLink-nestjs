import { registerEnumType } from '@nestjs/graphql';

/** Ciclo de vida de un intento de login por WhatsApp entrante. */
export enum WhatsAppLoginStatus {
  /** Emitido; esperando que llegue el mensaje del residente. */
  PENDING = 'PENDING',
  /** Llegó el mensaje desde el teléfono correcto; listo para canjear. */
  CONFIRMED = 'CONFIRMED',
  /** Ya se canjeó por una sesión. No se puede reutilizar. */
  CONSUMED = 'CONSUMED',
  /** Venció antes de confirmarse. */
  EXPIRED = 'EXPIRED',
}

registerEnumType(WhatsAppLoginStatus, {
  name: 'WhatsAppLoginStatus',
  description: 'Estado de un intento de login por mensaje entrante de WhatsApp',
});
