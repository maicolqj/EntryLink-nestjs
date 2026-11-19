import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcryptModule from 'bcrypt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Device } from '../entities/device.iot-entity';
import { DEVICE_ID_PREFIX, DeviceType } from '../enums/device-type.enum';

/** El proyecto no tiene @types/bcrypt: lo justo para tipar lo que se usa aquí. */
interface Bcrypt {
  hash(data: string, rounds: number): Promise<string>;
  compare(data: string, encrypted: string): Promise<boolean>;
}
const bcrypt = bcryptModule as unknown as Bcrypt;

const BCRYPT_COST = 10;
/** Tras un bcrypt correcto, la misma clave se acepta sin bcrypt durante este tiempo. */
const CACHE_MS = 10 * 60 * 1000;

/**
 * Identidad de los aparatos: genera deviceId/deviceKey/código y verifica la
 * clave. bcrypt cuesta ~70 ms; con batería la matera se conecta cada 30 min y
 * con USB una vez, así que basta una caché corta (por huella SHA-256 de la
 * clave, nunca la clave) para que REST responda en < 200 ms.
 *
 * El deviceKey en claro solo existe al crearlo (se devuelve una vez) y en la
 * NVS del aparato. Aquí no se loguea nunca.
 */
@Injectable()
export class DeviceCredentialsService {
  private readonly cache = new Map<string, { huella: Buffer; hasta: number }>();

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
  ) {}

  /** NEXUS-7F3A9C: prefijo del tipo + 6 hex. */
  newDeviceId(type: DeviceType): string {
    return `${DEVICE_ID_PREFIX[type]}-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  /** 48 caracteres hex (192 bits). El firmware admite 16-64 sin espacios. */
  newDeviceKey(): string {
    return randomBytes(24).toString('hex');
  }

  /** 6 hex en mayúsculas: cabe en el QR #2 y se lee bien en la pantalla. */
  newPairingCode(): string {
    return randomBytes(3).toString('hex').toUpperCase();
  }

  hashKey(deviceKey: string): Promise<string> {
    return bcrypt.hash(deviceKey, BCRYPT_COST);
  }

  /** El aparato si deviceId + deviceKey son correctos; null en cualquier otro caso. */
  async verify(
    deviceId: string | undefined,
    deviceKey: string | undefined,
  ): Promise<Device | null> {
    if (!deviceId || !deviceKey || deviceKey.length > 128) return null;
    const device = await this.devices
      .createQueryBuilder('d')
      .addSelect('d.deviceKeyHash')
      .where('d.deviceId = :deviceId', { deviceId })
      .getOne();
    if (!device?.deviceKeyHash) return null;

    const huella = createHash('sha256').update(deviceKey).digest();
    const enCache = this.cache.get(deviceId);
    if (
      enCache &&
      enCache.hasta > Date.now() &&
      timingSafeEqual(enCache.huella, huella)
    ) {
      return this.sinHash(device);
    }
    if (!(await bcrypt.compare(deviceKey, device.deviceKeyHash))) return null;
    this.cache.set(deviceId, { huella, hasta: Date.now() + CACHE_MS });
    return this.sinHash(device);
  }

  /** Tras regrabar la clave (servicio técnico) la caché anterior no vale. */
  forget(deviceId: string): void {
    this.cache.delete(deviceId);
  }

  private sinHash(device: Device): Device {
    delete (device as Partial<Device>).deviceKeyHash;
    return device;
  }
}
