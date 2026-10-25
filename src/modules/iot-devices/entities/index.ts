import { Device } from './device.iot-entity';
import { PlanterReading } from './planter-reading.iot-entity';
import { DeviceAlert } from './device-alert.iot-entity';
import { DeviceOutboxMessage } from './device-outbox.iot-entity';
import { DeviceNotificationType } from './device-notification-type.iot-entity';
import { DeviceNotificationRule } from './device-notification-rule.iot-entity';
import { DeviceNotificationPref } from './device-notification-pref.iot-entity';

export {
  Device,
  PlanterReading,
  DeviceAlert,
  DeviceOutboxMessage,
  DeviceNotificationType,
  DeviceNotificationRule,
  DeviceNotificationPref,
};

/** Se registran con TypeOrmModule.forFeature() solo si el módulo se carga. */
export const IOT_ENTITIES = [
  Device,
  PlanterReading,
  DeviceAlert,
  DeviceOutboxMessage,
  DeviceNotificationType,
  DeviceNotificationRule,
  DeviceNotificationPref,
];
