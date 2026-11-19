import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';

import { Device } from '../entities/device.iot-entity';
import { DeviceAlert } from '../entities/device-alert.iot-entity';
import { DeviceNotificationType } from '../entities/device-notification-type.iot-entity';
import { DeviceNotificationRule } from '../entities/device-notification-rule.iot-entity';
import { DeviceNotificationPref } from '../entities/device-notification-pref.iot-entity';
import { DeviceOutboxService } from '../services/device-outbox.service';
import { DevicePublisher } from '../mqtt/device-publisher';
import { IOT_CONFIG, IotConfig } from '../iot.config';
import { isQuietTime } from '../alerts/planter-alert.rules';
import {
  buildNotifyPayload,
  decideDelivery,
  DeliveryDecision,
} from './device-notification.policy';
import { EntrylinkNotificationJob } from '../queues/iot-queues.constants';
import { ValidRoles } from '../../roles/enums/valid-roles';

export interface EffectiveNotificationType extends DeviceNotificationType {
  /** Obligatorio por catálogo o por la regla del conjunto. */
  effectiveMandatory: boolean;
}

export interface DeviceNotificationPrefView {
  typeKey: string;
  enabled: boolean;
  mandatory: boolean;
}

/**
 * Catálogo, reglas del conjunto, preferencias del residente y entrega de los
 * avisos de EntryLink (paquete, pánico, comunicados, visitantes) a los aparatos.
 */
@Injectable()
export class DeviceNotificationsService {
  private readonly logger = new Logger(DeviceNotificationsService.name);

  constructor(
    @InjectRepository(DeviceNotificationType)
    private readonly types: Repository<DeviceNotificationType>,
    @InjectRepository(DeviceNotificationRule)
    private readonly rules: Repository<DeviceNotificationRule>,
    @InjectRepository(DeviceNotificationPref)
    private readonly prefs: Repository<DeviceNotificationPref>,
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(DeviceAlert)
    private readonly alerts: Repository<DeviceAlert>,
    @Inject(IOT_CONFIG) private readonly config: IotConfig,
    private readonly outbox: DeviceOutboxService,
    private readonly publisher: DevicePublisher,
  ) {}

  // ─────────────────────────── Catálogo y reglas ───────────────────────────

  async listTypes(complexId: string): Promise<EffectiveNotificationType[]> {
    const [tipos, reglas] = await Promise.all([
      this.types.find({ order: { priority: 'DESC', key: 'ASC' } }),
      this.rules.find({ where: { complexId } }),
    ]);
    const obligatorios = new Set(
      reglas.filter((r) => r.mandatory).map((r) => r.typeKey),
    );
    return tipos.map((t) => ({
      ...t,
      effectiveMandatory: t.mandatory || obligatorios.has(t.key),
    }));
  }

  /** La administración fija qué tipos son obligatorios en su conjunto. */
  async setComplexMandatory(
    complexId: string,
    typeKeys: string[],
  ): Promise<EffectiveNotificationType[]> {
    const existentes = new Set(
      (await this.types.find({ select: { key: true } })).map((t) => t.key),
    );
    const desconocidos = typeKeys.filter((k) => !existentes.has(k));
    if (desconocidos.length)
      throw new BadRequestException(
        `Tipos de aviso desconocidos: ${desconocidos.join(', ')}`,
      );
    await this.rules.delete({ complexId });
    if (typeKeys.length) {
      await this.rules.save(
        typeKeys.map((typeKey) =>
          this.rules.create({ complexId, typeKey, mandatory: true }),
        ),
      );
    }
    return this.listTypes(complexId);
  }

  // ─────────────────────────── Preferencias ───────────────────────────

  async getPrefs(
    userId: string,
    device: Device,
  ): Promise<DeviceNotificationPrefView[]> {
    const [tipos, propias] = await Promise.all([
      this.listTypes(device.complexId),
      this.prefs.find({ where: { userId, deviceUuid: device.id } }),
    ]);
    const porTipo = new Map(propias.map((p) => [p.typeKey, p.enabled]));
    return tipos.map((t) => ({
      typeKey: t.key,
      mandatory: t.effectiveMandatory,
      enabled: t.effectiveMandatory || (porTipo.get(t.key) ?? true),
    }));
  }

  async updatePrefs(
    userId: string,
    device: Device,
    cambios: { typeKey: string; enabled: boolean }[],
  ): Promise<DeviceNotificationPrefView[]> {
    const tipos = new Map(
      (await this.listTypes(device.complexId)).map((t) => [t.key, t]),
    );
    for (const c of cambios) {
      const tipo = tipos.get(c.typeKey);
      if (!tipo)
        throw new BadRequestException(
          `Tipo de aviso desconocido: ${c.typeKey}`,
        );
      if (!c.enabled && tipo.effectiveMandatory) {
        throw new ForbiddenException(
          `El aviso "${tipo.title}" es obligatorio y no se puede desactivar`,
        );
      }
    }
    for (const c of cambios) {
      await this.prefs.upsert(
        {
          userId,
          deviceUuid: device.id,
          typeKey: c.typeKey,
          enabled: c.enabled,
        },
        { conflictPaths: ['userId', 'deviceUuid', 'typeKey'] },
      );
    }
    return this.getPrefs(userId, device);
  }

  // ─────────────────────────── Entrega ───────────────────────────

  /** Worker: una notificación de EntryLink recién creada → aparatos de sus destinatarios. */
  async deliverFromEntrylink(job: EntrylinkNotificationJob): Promise<number> {
    const tipo = await this.types
      .createQueryBuilder('t')
      .where(':tipo = ANY(t.entrylinkTypes)', { tipo: job.type })
      .getOne();
    if (!tipo) return 0;

    const destino = await this.targetDevices(job);
    if (!destino.length) return 0;

    const reglas = await this.rules.find({
      where: { complexId: job.complexId, typeKey: tipo.key, mandatory: true },
    });
    const mandatory = tipo.mandatory || reglas.length > 0;
    const prefs = await this.prefs.find({
      where: { deviceUuid: In(destino.map((d) => d.id)), typeKey: tipo.key },
    });
    const pref = new Map(
      prefs.map((p) => [`${p.userId}:${p.deviceUuid}`, p.enabled]),
    );

    let enviados = 0;
    for (const device of destino) {
      const decision = decideDelivery(tipo, {
        mandatory,
        enabled: pref.get(`${device.ownerId}:${device.id}`),
        quiet: isQuietTime(
          new Date(),
          device.config?.quietHours,
          this.config.defaultTimeZone,
        ),
        connected: this.publisher.isConnected(device.deviceId),
      });
      if (
        await this.deliver(
          device,
          tipo,
          `n-${job.notificationId}`,
          job.title,
          decision,
        )
      )
        enviados++;
    }
    return enviados;
  }

  /** Prueba desde la app: muestra un aviso del catálogo en el aparato. */
  async sendTest(device: Device, typeKey: string): Promise<DeliveryDecision> {
    const tipo = await this.types.findOne({ where: { key: typeKey } });
    if (!tipo)
      throw new NotFoundException(`Tipo de aviso desconocido: ${typeKey}`);
    const decision: DeliveryDecision = this.publisher.isConnected(
      device.deviceId,
    )
      ? 'now'
      : 'queue';
    await this.deliver(device, tipo, `test-${Date.now()}`, null, decision);
    return decision;
  }

  private async deliver(
    device: Device,
    tipo: DeviceNotificationType,
    id: string,
    title: string | null,
    decision: DeliveryDecision,
  ): Promise<boolean> {
    if (decision === 'skip_disabled' || decision === 'skip_quiet') return false;
    const ahora = await this.outbox.send(
      device,
      'notify',
      buildNotifyPayload(tipo, id, title),
      tipo.deliveryTtlSec,
    );
    await this.alerts.save(
      this.alerts.create({
        deviceUuid: device.id,
        kind: tipo.key,
        channels: [ahora ? 'device' : 'device_queued'],
      }),
    );
    return true;
  }

  /**
   * Aparatos vinculados de los destinatarios. Directa → los del usuario en ese
   * conjunto. Broadcast → los del conjunto si va a residentes (o no dice a
   * quién); un broadcast solo para portería o administración no llega a las
   * materas de los residentes.
   */
  private targetDevices(job: EntrylinkNotificationJob): Promise<Device[]> {
    if (job.recipientUserId) {
      return this.devices.find({
        where: { ownerId: job.recipientUserId, complexId: job.complexId },
      });
    }
    if (!job.isBroadcast) return Promise.resolve<Device[]>([]);
    const roles = job.targetRoles ?? [];
    if (roles.length && !roles.includes(ValidRoles.RESIDENT_ROL))
      return Promise.resolve<Device[]>([]);
    return this.devices.find({
      where: { complexId: job.complexId, ownerId: Not(IsNull()) },
    });
  }
}
