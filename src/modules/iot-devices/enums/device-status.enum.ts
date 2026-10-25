import { registerEnumType } from '@nestjs/graphql';

/**
 * - UNPROVISIONED: recién creado o tras un reset de fábrica; todavía no ha
 *   hablado con el backend desde entonces.
 * - ONLINE: reportó hace menos de `IOT_OFFLINE_AFTER_MIN` (2 h por defecto).
 *   Con batería duerme 30 min entre lecturas y sigue contando como ONLINE.
 * - OFFLINE: lo marca el job horario cuando deja de reportar.
 *
 * Si está conectado AHORA mismo al broker lo dice `Device.connected`, que es
 * lo que decide si un aviso llega en tiempo real.
 */
export enum DeviceStatus {
  UNPROVISIONED = 'UNPROVISIONED',
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
}

registerEnumType(DeviceStatus, {
  name: 'IotDeviceStatus',
  description: 'Estado de conexión del dispositivo IoT',
});
