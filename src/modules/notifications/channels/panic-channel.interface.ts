import { PanicDeliveryChannel } from '../enums/panic-delivery-channel.enum';
import { PanicAlert }           from '../entities/panic-alert.entity';

/** Datos que todo canal recibe para emitir una alerta. */
export interface PanicChannelContext {
  alert:            PanicAlert;
  /** Destinatarios resueltos para este nivel. */
  userIds:          string[];
  /** Nivel que originó el envío (0 = inmediato, 1..3 = escalamiento). */
  escalationLevel:  number;
  title:            string;
  body:             string;
}

export interface PanicChannelResult {
  /** Cuántos destinos se alcanzaron. 0 con `skippedReason` = canal no disponible. */
  reached:       number;
  skippedReason?: string;
}

/**
 * Un canal por el que puede salir una alerta de pánico.
 *
 * La máquina de escalamiento no sabe qué canales existen: pide los del nivel y
 * despacha. Esto es lo que permite arrancar hoy con FCM, socket y correo, y
 * enchufar SMS y voz cuando haya proveedor sin tocar la lógica de niveles.
 *
 * Contrato duro: un canal NUNCA lanza. Un proveedor caído no puede tumbar el
 * escalamiento, porque los niveles siguientes son justamente la red de
 * seguridad. Los fallos se reportan como resultado y quedan en la auditoría.
 */
export interface PanicChannel {
  readonly channel: PanicDeliveryChannel;

  /**
   * Si el canal puede operar ahora mismo (credenciales, plantillas, proveedor).
   * Un canal no disponible se salta con motivo registrado, no se reintenta.
   */
  isAvailable(): boolean;

  /** Motivo legible cuando `isAvailable()` es false. Va a la auditoría. */
  unavailableReason(): string;

  send(ctx: PanicChannelContext): Promise<PanicChannelResult>;
}
