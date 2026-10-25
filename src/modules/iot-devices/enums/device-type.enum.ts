import { registerEnumType } from '@nestjs/graphql';

/**
 * Tipos de aparato. La base (`Device`) es común; cada tipo guarda su
 * telemetría en su propia tabla (hoy solo `PlanterReading`) y tiene su
 * prefijo de `deviceId`. Agregar un tipo = un valor aquí, su prefijo en
 * `DEVICE_ID_PREFIX` y, si reporta datos, su entidad de lecturas.
 */
export enum DeviceType {
  SMART_PLANTER = 'SMART_PLANTER',
  SMART_LOCK = 'SMART_LOCK',
  SENSOR = 'SENSOR',
  CAMERA = 'CAMERA',
}

export const DEVICE_ID_PREFIX: Record<DeviceType, string> = {
  [DeviceType.SMART_PLANTER]: 'NEXUS',
  [DeviceType.SMART_LOCK]: 'LOCK',
  [DeviceType.SENSOR]: 'SENSOR',
  [DeviceType.CAMERA]: 'CAM',
};

registerEnumType(DeviceType, {
  name: 'IotDeviceType',
  description: 'Tipo de dispositivo IoT',
});
