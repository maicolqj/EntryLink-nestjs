import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import {
  Device,
  DeviceConfig,
  PlantProfile,
} from '../entities/device.iot-entity';
import { PlanterReading } from '../entities/planter-reading.iot-entity';
import { DeviceNotificationPref } from '../entities/device-notification-pref.iot-entity';
import { DeviceType } from '../enums/device-type.enum';
import { DeviceStatus } from '../enums/device-status.enum';
import { IOT_CONFIG, IotConfig } from '../iot.config';
import { DeviceCredentialsService } from './device-credentials.service';
import { DeviceOutboxService } from './device-outbox.service';
import { PlantProfilesService } from '../plants/plant-profiles.service';
import { IotSocketEmitter, IotSocketEvent } from '../socket/iot-socket.events';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { User } from '../../users/entities/user.entity';
import { Resident } from '../../residents/entities/resident.entity';
import { ResidentStatus } from '../../residents/enums/resident-status.enum';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreatedDevice {
  device: Device;
  /** Se devuelve UNA sola vez: solo se guarda su hash. */
  deviceKey: string;
  pairingCode: string;
  /** Fila para tools/flash_identity.py: deviceId,deviceKey,type,complexId,pairingCode */
  csvLine: string;
}

export interface PairingCodeResponse {
  code: string;
  /** epoch en segundos */
  expiresAt: number;
  expiresIn: number;
}

/**
 * Ciclo de vida de los aparatos: alta de fábrica, vinculación por código,
 * reset de fábrica (la única forma de transferir), configuración, planta,
 * OTA y consultas para RemoteLink.
 */
@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(PlanterReading)
    private readonly readings: Repository<PlanterReading>,
    @InjectRepository(DeviceNotificationPref)
    private readonly prefs: Repository<DeviceNotificationPref>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Resident)
    private readonly residents: Repository<Resident>,
    @InjectRepository(ResidentialComplex)
    private readonly complexes: Repository<ResidentialComplex>,
    @Inject(IOT_CONFIG) private readonly config: IotConfig,
    private readonly credentials: DeviceCredentialsService,
    private readonly outbox: DeviceOutboxService,
    private readonly plants: PlantProfilesService,
    private readonly sockets: IotSocketEmitter,
  ) {}

  // ─────────────────────────── Permisos ───────────────────────────

  private esSuperAdmin(u: JwtAccessPayload): boolean {
    return u.roles?.includes(ValidRoles.SUPER_ADMIN_ROL);
  }

  /** Administración del conjunto del aparato (o SUPER_ADMIN). */
  private esAdminDe(u: JwtAccessPayload, complexId: string): boolean {
    return (
      this.esSuperAdmin(u) ||
      (u.roles?.includes(ValidRoles.COMPLEX_ROL) && u.complexId === complexId)
    );
  }

  private assertCanView(device: Device, u: JwtAccessPayload): void {
    if (device.ownerId === u.sub || this.esAdminDe(u, device.complexId)) return;
    throw new ForbiddenException('No tienes acceso a este dispositivo');
  }

  private assertOwner(device: Device, u: JwtAccessPayload): void {
    if (device.ownerId !== u.sub)
      throw new ForbiddenException('Solo el dueño puede hacer esto');
  }

  /** Acepta el uuid interno o el deviceId público (NEXUS-7F3A9C). */
  async findRef(ref: string): Promise<Device> {
    const device = await this.devices.findOne({
      where: UUID.test(ref) ? { id: ref } : { deviceId: ref },
    });
    if (!device) throw new NotFoundException('Dispositivo no encontrado');
    return device;
  }

  // ─────────────────────────── Alta (fábrica) ───────────────────────────

  async createDevice(
    type: DeviceType,
    complexId: string,
    u: JwtAccessPayload,
  ): Promise<CreatedDevice> {
    if (!this.esAdminDe(u, complexId))
      throw new ForbiddenException('No administras ese conjunto');
    if (!(await this.complexes.exists({ where: { id: complexId } }))) {
      throw new NotFoundException('Conjunto residencial no encontrado');
    }
    const deviceKey = this.credentials.newDeviceKey();
    const deviceKeyHash = await this.credentials.hashKey(deviceKey);
    const pairingCode = this.credentials.newPairingCode();

    // deviceId aleatorio de 6 hex: ante el (raro) choque, otro
    for (let intento = 0; intento < 5; intento++) {
      const deviceId = this.credentials.newDeviceId(type);
      if (await this.devices.exists({ where: { deviceId } })) continue;
      const device = await this.devices.save(
        this.devices.create({
          type,
          deviceId,
          deviceKeyHash,
          complexId,
          pairingCode,
          pairingCodeExpiresAt: this.caducidadCodigo(),
          status: DeviceStatus.UNPROVISIONED,
          config: {},
        }),
      );
      delete (device as Partial<Device>).deviceKeyHash;
      this.logger.log(
        `[alta] ${deviceId} (${type}) para el conjunto ${complexId}`,
      );
      return {
        device,
        deviceKey,
        pairingCode,
        csvLine: [deviceId, deviceKey, type, complexId, pairingCode].join(','),
      };
    }
    throw new ConflictException(
      'No se pudo generar un deviceId único, inténtalo de nuevo',
    );
  }

  async regeneratePairingCode(
    ref: string,
    u: JwtAccessPayload,
  ): Promise<Device> {
    const device = await this.findRef(ref);
    if (!this.esAdminDe(u, device.complexId))
      throw new ForbiddenException('No administras este dispositivo');
    await this.nuevoCodigo(device);
    return this.findRef(device.id);
  }

  // ─────────────────────────── Desde el aparato (REST) ───────────────────────────

  /** POST /iot/devices/pairing-code: código nuevo cada vez (el anterior deja de valer). */
  async requestPairingCode(device: Device): Promise<PairingCodeResponse> {
    const code = await this.nuevoCodigo(device);
    if (device.status === DeviceStatus.UNPROVISIONED) {
      await this.devices.update(device.id, {
        status: DeviceStatus.ONLINE,
        lastSeenAt: new Date(),
      });
    }
    const ttl = this.config.pairingCodeTtlS;
    return {
      code,
      expiresAt: Math.floor(Date.now() / 1000) + ttl,
      expiresIn: ttl,
    };
  }

  /** GET /iot/devices/<id>/status (respaldo del firmware si MQTT no conecta). */
  async getStatus(
    device: Device,
  ): Promise<{ deviceId: string; linked: boolean; owner: string | null }> {
    const owner = device.ownerId ? await this.nombreDe(device.ownerId) : null;
    return { deviceId: device.deviceId, linked: !!device.ownerId, owner };
  }

  /** GET /iot/devices/<id>/plant: null → 204. */
  getPlant(device: Device): PlantProfile | null {
    return device.config?.plant ?? null;
  }

  // ─────────────────────────── Vinculación ───────────────────────────

  async linkDeviceByCode(
    rawCode: string,
    u: JwtAccessPayload,
  ): Promise<Device> {
    const code = (rawCode ?? '').trim().toUpperCase();
    const device = code
      ? await this.devices.findOne({ where: { pairingCode: code } })
      : null;
    if (!device)
      throw new NotFoundException(
        'Código inválido. Revisa el código que muestra la pantalla de la matera',
      );
    if (
      !device.pairingCodeExpiresAt ||
      device.pairingCodeExpiresAt.getTime() <= Date.now()
    ) {
      throw new GoneException(
        'El código caducó. Espera a que la matera muestre uno nuevo',
      );
    }
    if (device.ownerId && device.ownerId !== u.sub) {
      throw new ConflictException(
        'Este dispositivo ya está vinculado a otra cuenta. Su dueño debe hacer un reset de fábrica',
      );
    }
    if (!u.complexId || device.complexId !== u.complexId) {
      throw new ForbiddenException(
        'Este dispositivo pertenece a otro conjunto residencial',
      );
    }

    const unitId = await this.unidadDe(u.sub, device.complexId);
    // Atómico: si dos personas usan el mismo código a la vez, solo una gana
    const r = await this.devices
      .createQueryBuilder()
      .update(Device)
      .set({
        ownerId: u.sub,
        unitId,
        pairingCode: null,
        pairingCodeExpiresAt: null,
      })
      .where(
        'id = :id AND pairing_code = :code AND pairing_code_expires_at > now()',
        { id: device.id, code },
      )
      .andWhere('(owner_id IS NULL OR owner_id = :u)', { u: u.sub })
      .execute();
    if (!r.affected)
      throw new ConflictException(
        'El código ya se usó. Pide uno nuevo en la matera',
      );

    const owner = (await this.nombreDe(u.sub)) ?? '';
    await this.outbox.sendCommand(device, 'linked', {
      owner: owner.slice(0, 31),
    });
    const vinculado = await this.findRef(device.id);
    this.sockets.toUser(u.sub, IotSocketEvent.LINKED, {
      id: vinculado.id,
      deviceId: vinculado.deviceId,
    });
    this.logger.log(`[vincular] ${device.deviceId} → usuario ${u.sub}`);
    return vinculado;
  }

  /**
   * Transferir = reset de fábrica completo: sin dueño, código nuevo,
   * UNPROVISIONED, config vacía, y la orden al aparato de borrar su WiFi y
   * volver al QR de configuración. No existe "desvincular conservando WiFi".
   */
  async factoryResetDevice(
    ref: string,
    u: JwtAccessPayload,
    wipeCalibration = false,
  ): Promise<Device> {
    const device = await this.findRef(ref);
    if (device.ownerId !== u.sub && !this.esAdminDe(u, device.complexId)) {
      throw new ForbiddenException(
        'Solo el dueño o la administración pueden resetear este dispositivo',
      );
    }
    const dueñoAnterior = device.ownerId;
    await this.devices.update(device.id, {
      ownerId: null,
      unitId: null,
      status: DeviceStatus.UNPROVISIONED,
      config: {},
      faceTheme: 'classic',
    });
    await this.nuevoCodigo(device);
    await this.prefs.delete({ deviceUuid: device.id });
    await this.outbox.discardPending(device.id);
    await this.outbox.sendCommand(
      device,
      'factory_reset',
      wipeCalibration ? { wipe_calib: true } : {},
    );
    if (dueñoAnterior) {
      this.sockets.toUser(dueñoAnterior, IotSocketEvent.FACTORY_RESET, {
        id: device.id,
        deviceId: device.deviceId,
      });
    }
    this.logger.log(
      `[reset] ${device.deviceId} por ${u.sub}${wipeCalibration ? ' (con calibración)' : ''}`,
    );
    return this.findRef(device.id);
  }

  // ─────────────────────────── Ajustes del dueño ───────────────────────────

  async renameDevice(
    ref: string,
    name: string,
    u: JwtAccessPayload,
  ): Promise<Device> {
    const device = await this.findRef(ref);
    this.assertOwner(device, u);
    const limpio = (name ?? '').trim().slice(0, 80);
    if (!limpio)
      throw new BadRequestException('El nombre no puede estar vacío');
    await this.devices.update(device.id, { name: limpio });
    return this.findRef(device.id);
  }

  /** Solo las claves conocidas; `plant` va por setDevicePlant. */
  async updateDeviceConfig(
    ref: string,
    cambios: Record<string, unknown>,
    u: JwtAccessPayload,
  ): Promise<Device> {
    const device = await this.findRef(ref);
    this.assertOwner(device, u);
    const config: DeviceConfig = { ...(device.config ?? {}) };
    for (const [k, v] of Object.entries(cambios ?? {})) {
      if (k === 'notifyComplexAdmins') {
        if (typeof v !== 'boolean')
          throw new BadRequestException(`${k} debe ser true o false`);
        config[k] = v;
      } else if (k === 'quietHours') {
        if (v === null) delete config.quietHours;
        else config.quietHours = this.validarSilencio(v);
      } else {
        throw new BadRequestException(`Ajuste desconocido: ${k}`);
      }
    }
    await this.devices.update(device.id, { config });
    return this.findRef(device.id);
  }

  async setDevicePlant(
    ref: string,
    plantId: string,
    u: JwtAccessPayload,
  ): Promise<Device> {
    const device = await this.findRef(ref);
    this.assertOwner(device, u);
    const plant = this.plants.get(plantId);
    await this.devices.update(device.id, {
      config: { ...(device.config ?? {}), plant },
    });
    // Push: llega ya (USB) o al despertar. Pull: la matera también la pide con GET /plant
    await this.outbox.sendCommand(device, 'set_plant', { ...plant });
    return this.findRef(device.id);
  }

  async clearDevicePlant(ref: string, u: JwtAccessPayload): Promise<Device> {
    const device = await this.findRef(ref);
    this.assertOwner(device, u);
    const config = { ...(device.config ?? {}) };
    delete config.plant;
    // El firmware no tiene "quitar planta": vuelve al genérico cuando GET /plant da 204 (al encender)
    await this.devices.update(device.id, { config });
    return this.findRef(device.id);
  }

  async identifyDevice(ref: string, u: JwtAccessPayload): Promise<boolean> {
    const device = await this.findRef(ref);
    this.assertCanView(device, u);
    return this.outbox.sendCommand(device, 'identify');
  }

  /** Solo SUPER_ADMIN (el resolver lo exige). El aparato rechaza el OTA sin USB o con poca batería. */
  async startOta(
    ref: string,
    url: string,
    sha256: string,
    version: string,
  ): Promise<boolean> {
    const device = await this.findRef(ref);
    const permitida =
      /^https:\/\//i.test(url) ||
      (process.env.NODE_ENV !== 'production' && /^http:\/\//i.test(url));
    if (!permitida)
      throw new BadRequestException('La URL del firmware debe ser https://');
    if (!/^[0-9a-f]{64}$/i.test(sha256))
      throw new BadRequestException('sha256 debe tener 64 caracteres hex');
    if (!version || version.length > 15)
      throw new BadRequestException('Versión inválida');
    return this.outbox.sendCommand(device, 'ota', {
      url,
      sha256: sha256.toLowerCase(),
      version,
    });
  }

  // ─────────────────────────── Consultas ───────────────────────────

  myDevices(u: JwtAccessPayload): Promise<Device[]> {
    return this.devices.find({
      where: { ownerId: u.sub },
      order: { createdAt: 'ASC' },
    });
  }

  async device(ref: string, u: JwtAccessPayload): Promise<Device> {
    const device = await this.findRef(ref);
    this.assertCanView(device, u);
    return device;
  }

  async deviceReadings(
    ref: string,
    from: Date,
    to: Date,
    page: number,
    limit: number,
    u: JwtAccessPayload,
  ): Promise<{ items: PlanterReading[]; total: number }> {
    const device = await this.device(ref, u);
    if (from > to)
      throw new BadRequestException('"from" debe ser anterior a "to"');
    const take = Math.min(Math.max(limit, 1), 500);
    const [items, total] = await this.readings.findAndCount({
      where: { deviceUuid: device.id, measuredAt: Between(from, to) },
      order: { measuredAt: 'ASC' },
      skip: (Math.max(page, 1) - 1) * take,
      take,
    });
    return { items, total };
  }

  devicesByComplex(complexId: string, u: JwtAccessPayload): Promise<Device[]> {
    if (!this.esAdminDe(u, complexId))
      throw new ForbiddenException('No administras ese conjunto');
    return this.devices.find({
      where: { complexId },
      order: { createdAt: 'ASC' },
    });
  }

  // ─────────────────────────── Internos ───────────────────────────

  private caducidadCodigo(): Date {
    return new Date(Date.now() + this.config.pairingCodeTtlS * 1000);
  }

  /** Código nuevo y único (índice parcial). */
  private async nuevoCodigo(device: Device): Promise<string> {
    for (let intento = 0; intento < 5; intento++) {
      const code = this.credentials.newPairingCode();
      if (await this.devices.exists({ where: { pairingCode: code } })) continue;
      await this.devices.update(device.id, {
        pairingCode: code,
        pairingCodeExpiresAt: this.caducidadCodigo(),
      });
      return code;
    }
    throw new ConflictException('No se pudo generar un código de vinculación');
  }

  private async nombreDe(userId: string): Promise<string | null> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, name: true },
    });
    return user?.name ?? null;
  }

  private async unidadDe(
    userId: string,
    complexId: string,
  ): Promise<string | null> {
    const r = await this.residents.findOne({
      where: { userId, complexId, status: ResidentStatus.ACTIVE },
      select: { id: true, unitId: true },
    });
    return r?.unitId ?? null;
  }

  private validarSilencio(v: unknown): NonNullable<DeviceConfig['quietHours']> {
    const q = v as Record<string, unknown> | null;
    const hora = /^([01]?\d|2[0-3]):[0-5]\d$/;
    if (
      !q ||
      typeof q.start !== 'string' ||
      typeof q.end !== 'string' ||
      !hora.test(q.start) ||
      !hora.test(q.end)
    ) {
      throw new BadRequestException(
        'quietHours: { start: "HH:mm", end: "HH:mm", timeZone? }',
      );
    }
    let timeZone: string | undefined;
    if (q.timeZone !== undefined) {
      if (typeof q.timeZone !== 'string') {
        throw new BadRequestException('quietHours.timeZone debe ser texto');
      }
      timeZone = q.timeZone;
      try {
        new Intl.DateTimeFormat('es-CO', { timeZone });
      } catch {
        throw new BadRequestException(`Zona horaria inválida: ${timeZone}`);
      }
    }
    return {
      start: q.start,
      end: q.end,
      ...(timeZone ? { timeZone } : {}),
    };
  }
}
