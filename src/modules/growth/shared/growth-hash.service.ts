import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { CustomError } from '../../shared/utils/errors.utils';
import { GrowthErrorCode } from './growth-error-codes';
import { GrowthIdentifierType } from './growth.enums';
import { normalizeIdentifier } from './identifier-normalizer';

export interface VersionedHash {
  keyVersion: number;
  hash: string;
}

/**
 * Hash con llave (HMAC-SHA256) de los identificadores de la lista de
 * exclusión y de las solicitudes de titulares. La base nunca guarda el correo,
 * el teléfono o el NIT en claro.
 *
 * Llavero versionado — `GROWTH_SUPPRESSION_HMAC_KEYS="1:<base64>,2:<base64>"`
 * y `GROWTH_SUPPRESSION_HMAC_ACTIVE_VERSION=2`:
 *  - Lo nuevo se escribe con la versión activa.
 *  - Para consultar se calcula el hash con TODAS las versiones del llavero, así
 *    una exclusión hecha con una llave anterior sigue bloqueando.
 *  - Rotar no necesita los datos originales: cuando un dato en claro coincide
 *    con un hash de una versión vieja, se agrega su hash con la versión activa
 *    (re-hash oportunista). Una versión vieja solo sale del llavero cuando
 *    ninguna exclusión depende de ella (`SuppressionsService.keyStatus`).
 */
@Injectable()
export class GrowthHashService {
  private readonly keys: Map<number, Buffer>;
  readonly activeVersion: number;

  constructor(config: ConfigService) {
    const parsed = GrowthHashService.parseKeyring(
      config.get<string>('GROWTH_SUPPRESSION_HMAC_KEYS'),
      config.get<string | number>('GROWTH_SUPPRESSION_HMAC_ACTIVE_VERSION'),
    );
    this.keys = parsed.keys;
    this.activeVersion = parsed.activeVersion;
  }

  static parseKeyring(
    rawKeys: string | undefined,
    rawActive: string | number | undefined,
  ): { keys: Map<number, Buffer>; activeVersion: number } {
    const fail = (message: string) =>
      new CustomError({
        message,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        errorCode: GrowthErrorCode.GROWTH_HMAC_MISCONFIGURED,
      });

    const keys = new Map<number, Buffer>();
    for (const entry of (rawKeys ?? '').split(',').map((e) => e.trim())) {
      if (!entry) continue;
      const sep = entry.indexOf(':');
      const version = Number(entry.slice(0, sep));
      const key = Buffer.from(entry.slice(sep + 1), 'base64');
      if (sep < 1 || !Number.isInteger(version) || version < 1) {
        throw fail('Versión de llave HMAC inválida');
      }
      if (key.length < 32) {
        throw fail(`La llave HMAC v${version} debe tener al menos 32 bytes`);
      }
      if (keys.has(version)) throw fail(`Llave HMAC v${version} repetida`);
      keys.set(version, key);
    }
    if (!keys.size) throw fail('No hay llaves HMAC configuradas');

    const activeVersion = Number(rawActive);
    if (!keys.has(activeVersion)) {
      throw fail('La versión activa de la llave HMAC no está en el llavero');
    }
    return { keys, activeVersion };
  }

  get versions(): number[] {
    return [...this.keys.keys()].sort((a, b) => b - a);
  }

  /** Normaliza o lanza GROWTH_INVALID_IDENTIFIER. */
  normalize(type: GrowthIdentifierType, raw: string): string {
    const normalized = normalizeIdentifier(type, raw);
    if (!normalized) {
      throw new CustomError({
        message: `El ${type.toLowerCase()} no es válido`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GrowthErrorCode.GROWTH_INVALID_IDENTIFIER,
      });
    }
    return normalized;
  }

  /** Hash con la versión activa (para escribir). */
  hashActive(type: GrowthIdentifierType, raw: string): VersionedHash {
    return this.hashWith(this.activeVersion, type, this.normalize(type, raw));
  }

  /** Hash con todas las versiones del llavero (para consultar). */
  hashAll(type: GrowthIdentifierType, raw: string): VersionedHash[] {
    const normalized = this.normalize(type, raw);
    return this.versions.map((v) => this.hashWith(v, type, normalized));
  }

  private hashWith(
    version: number,
    type: GrowthIdentifierType,
    normalized: string,
  ): VersionedHash {
    const key = this.keys.get(version) as Buffer;
    // El tipo entra en el mensaje: un NIT y un teléfono iguales no colisionan.
    const hash = createHmac('sha256', key)
      .update(`${type}:${normalized}`)
      .digest('hex');
    return { keyVersion: version, hash };
  }
}
