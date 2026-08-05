import { registerEnumType } from '@nestjs/graphql';

/**
 * Canales por los que puede salir una alerta de pánico.
 *
 * El enum declara el diseño completo, no lo que hoy está conectado: SMS y VOICE
 * no tienen proveedor contratado y WHATSAPP está a la espera de una plantilla
 * aprobada por Meta. Cada adaptador informa su propia disponibilidad, así que un
 * canal sin implementar se salta con motivo registrado en vez de romper el
 * escalamiento — y enchufarlo después no toca la máquina.
 */
export enum PanicDeliveryChannel {
  FCM      = 'FCM',
  SOCKET   = 'SOCKET',
  EMAIL    = 'EMAIL',
  WHATSAPP = 'WHATSAPP',
  SMS      = 'SMS',
  VOICE    = 'VOICE',
}

registerEnumType(PanicDeliveryChannel, {
  name: 'PanicDeliveryChannel',
  description: 'Canal de entrega de una alerta de pánico',
});
