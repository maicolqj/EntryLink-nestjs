import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Device } from '../entities/device.iot-entity';
import { DeviceAlert } from '../entities/device-alert.iot-entity';
import { IOT_CONFIG, IotConfig } from '../iot.config';
import { IotSocketEmitter, IotSocketEvent } from '../socket/iot-socket.events';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import {
  alertText,
  isQuietTime,
  isThrottled,
  PlanterAlertKind,
  ReadingForRules,
} from './planter-alert.rules';

/**
 * Tipo del push de las alertas de aparatos. No existe en el enum de EntryLink
 * (no se toca): solo viaja en `data.type` del push para que RemoteLink abra la
 * pantalla del aparato. El aviso NO va al buzón (dispatchPushOnly).
 */
export const DEVICE_ALERT_PUSH_TYPE =
  'DEVICE_ALERT' as unknown as NotificationType;

export type DispatchOutcome = 'sent' | 'throttled' | 'quiet' | 'no_owner';

/**
 * Envía una alerta de aparato al dueño con las reglas de la PARTE D:
 *  - throttling por (aparato, tipo) contra `iot_device_alerts`;
 *  - horas de silencio de `config.quietHours`: no hay push y NO se registra,
 *    así que el aviso sale con la primera lectura después del silencio;
 *  - canales: push + socket; socket a la administración si
 *    `config.notifyComplexAdmins`; WhatsApp para `tank_empty` si
 *    `config.whatsappEnabled` (pendiente: ver `sendWhatsapp`).
 * Portería (SECURITY_ROL) no recibe nunca estas alertas.
 */
@Injectable()
export class DeviceAlertDispatcher {
  private readonly logger = new Logger(DeviceAlertDispatcher.name);

  constructor(
    @InjectRepository(DeviceAlert)
    private readonly alerts: Repository<DeviceAlert>,
    @Inject(IOT_CONFIG) private readonly config: IotConfig,
    private readonly notifications: NotificationsService,
    private readonly sockets: IotSocketEmitter,
  ) {}

  async dispatch(
    device: Device,
    kind: PlanterAlertKind,
    reading?: ReadingForRules & { previousSoil?: number },
    now: Date = new Date(),
  ): Promise<DispatchOutcome> {
    if (!device.ownerId) return 'no_owner';

    const ultima = await this.alerts.findOne({
      where: { deviceUuid: device.id, kind },
      order: { createdAt: 'DESC' },
    });
    if (isThrottled(kind, ultima?.createdAt, now)) return 'throttled';
    if (
      isQuietTime(now, device.config?.quietHours, this.config.defaultTimeZone)
    )
      return 'quiet';

    const nombre = device.name || 'Tu matera';
    const { title, body } = alertText(kind, nombre, reading);
    const channels: string[] = ['socket'];
    const evento = {
      id: device.id,
      deviceId: device.deviceId,
      kind,
      title,
      body,
      at: now.toISOString(),
    };

    this.sockets.toUser(device.ownerId, IotSocketEvent.ALERT, evento);
    if (device.config?.notifyComplexAdmins) {
      this.sockets.toComplexAdmins(
        device.complexId,
        IotSocketEvent.ALERT,
        evento,
      );
      channels.push('socket_admin');
    }

    try {
      await this.notifications.dispatchPushOnly([device.ownerId], {
        complexId: device.complexId,
        userIds: [device.ownerId],
        type: DEVICE_ALERT_PUSH_TYPE,
        priority:
          kind === 'watering'
            ? NotificationPriority.LOW
            : NotificationPriority.NORMAL,
        title,
        body,
        entityId: device.id,
        entityType: 'IotDevice',
        metadata: { deviceId: device.deviceId, kind },
      });
      channels.push('push');
    } catch (e) {
      this.logger.warn(
        `[alert] push ${kind} de ${device.deviceId} falló: ${e instanceof Error ? e.message : e}`,
      );
    }

    if (
      kind === 'tank_empty' &&
      device.config?.whatsappEnabled &&
      this.sendWhatsapp(device)
    ) {
      channels.push('whatsapp');
    }

    await this.alerts.save(
      this.alerts.create({ deviceUuid: device.id, kind, channels }),
    );
    return 'sent';
  }

  /**
   * TODO: el backend todavía no tiene un servicio de Twilio/WhatsApp (no hay
   * dependencia ni código que reutilizar). Cuando exista, se llama aquí. Hasta
   * entonces solo se registra, igual que `WhatsAppPanicChannel` en pánico.
   */
  private sendWhatsapp(device: Device): boolean {
    this.logger.log(
      `[alert] WhatsApp de ${device.deviceId} no disponible: falta el servicio de Twilio`,
    );
    return false;
  }
}
