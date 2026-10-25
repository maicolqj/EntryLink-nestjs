import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';

import { IOT_ENTITIES } from './entities';
import { IOT_CONFIG, loadIotConfig } from './iot.config';
import {
  DEVICE_ALERTS_QUEUE,
  DEVICE_NOTIFY_QUEUE,
} from './queues/iot-queues.constants';

import { DeviceCredentialsService } from './services/device-credentials.service';
import { DeviceOutboxService } from './services/device-outbox.service';
import { DeviceIngressService } from './services/device-ingress.service';
import { DevicesService } from './services/devices.service';
import { DevicePublisher } from './mqtt/device-publisher';
import { IotMqttBroker } from './mqtt/iot-mqtt.broker';
import { DeviceAlertDispatcher } from './alerts/device-alert.dispatcher';
import { DeviceAlertsProcessor } from './queues/device-alerts.processor';
import { DeviceNotifyProcessor } from './queues/device-notify.processor';
import { DevicesOfflineCron } from './cron/devices-offline.cron';
import { DeviceNotificationsService } from './notifications/device-notifications.service';
import { EntrylinkNotificationSubscriber } from './notifications/entrylink-notification.subscriber';
import { PlantProfilesService } from './plants/plant-profiles.service';
import { IotSocketEmitter } from './socket/iot-socket.events';
import { DeviceKeyGuard } from './guards/device-key.guard';
import { IotDevicesController } from './controllers/iot-devices.controller';
import { IotDevicesResolver } from './resolvers/iot-devices.resolver';

import { NotificationsModule } from '../notifications/notifications.module';
import { User } from '../users/entities/user.entity';
import { Resident } from '../residents/entities/resident.entity';
import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';

/**
 * Dispositivos IoT (matera Niko / NEXUS v5 y futuros tipos).
 *
 * AUTOCONTENIDO Y APAGADO POR DEFECTO: AppModule solo lo carga con
 * IOT_ENABLED=true (y con `require`, así que sin el flag no se carga ni un
 * archivo de esta carpeta). Sus entidades van en `*.iot-entity.ts` para que el
 * glob global de TypeORM no las vea y se registran aquí con forFeature
 * (autoLoadEntities). Broker MQTT, colas, cron y suscriptor viven y mueren con
 * el módulo. No modifica nada existente: lo que necesita (notificaciones,
 * sockets, usuarios) lo importa. Ver README_IOT.md.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ...IOT_ENTITIES,
      User,
      Resident,
      ResidentialComplex,
    ]),
    BullModule.registerQueue(
      { name: DEVICE_ALERTS_QUEUE },
      { name: DEVICE_NOTIFY_QUEUE },
    ),
    NotificationsModule, // push (dispatchPushOnly)
    // SocketModule es @Global(); ScheduleModule y BullModule.forRoot ya están en AppModule
  ],
  controllers: [IotDevicesController],
  providers: [
    { provide: IOT_CONFIG, useFactory: () => loadIotConfig() },
    IotSocketEmitter,
    DeviceCredentialsService,
    DevicePublisher,
    DeviceOutboxService,
    DeviceIngressService,
    DevicesService,
    PlantProfilesService,
    IotMqttBroker,
    DeviceAlertDispatcher,
    DeviceAlertsProcessor,
    DevicesOfflineCron,
    DeviceNotificationsService,
    EntrylinkNotificationSubscriber,
    DeviceNotifyProcessor,
    DeviceKeyGuard,
    IotDevicesResolver,
  ],
})
export class IotDevicesModule {}
