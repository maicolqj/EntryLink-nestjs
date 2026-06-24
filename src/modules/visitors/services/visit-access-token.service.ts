import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';

import { CacheService } from '../../../core/infrastructure/cache/cache.service';

/** Tipo discriminante para evitar que cualquier otro JWT del server pase como token de acceso. */
const TOKEN_TYPE = 'visit_access';
/** TTL corto: el token solo sirve para confirmar el ingreso inmediato tras escanear el QR. */
const TTL_SECONDS = 5 * 60; // 5 minutos
/** Prefijo de la clave en Redis que respalda el uso único del token. */
const CACHE_PREFIX = 'visit-access';

interface VisitAccessTokenPayload {
  visitId: string;
  visitorId: string;
  jti: string;
  type: typeof TOKEN_TYPE;
}

export interface VerifiedVisitAccessToken {
  visitId: string;
  visitorId: string;
  jti: string;
}

/**
 * Emite, verifica y consume tokens de acceso de UN SOLO USO para registrar el
 * ingreso de visitas SCHEDULED tras escanear su QR (Option A).
 *
 * Seguridad combinada (reusa los dos mecanismos del proyecto):
 *  - JWT firmado con JWT_ACCESS_SECRET (HS256) + exp → firma a prueba de
 *    manipulación y expiración; el visitId va dentro y no puede forjarse.
 *  - Registro `jti` en Redis (CacheService) → uso único real: `consume()`
 *    elimina la clave, de modo que reusar el mismo token produce cache-miss.
 */
@Injectable()
export class VisitAccessTokenService {
  private readonly logger = new Logger(VisitAccessTokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {}

  /** Genera un token de un solo uso atado a la visita y al visitante. */
  async issue(visitId: string, visitorId: string): Promise<string> {
    const jti = uuidv4();
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');

    const token = await this.jwtService.signAsync(
      { visitId, visitorId, jti, type: TOKEN_TYPE } as VisitAccessTokenPayload,
      { secret, expiresIn: `${TTL_SECONDS}s`, algorithm: 'HS256' },
    );

    // Mientras exista la clave, el token NO ha sido consumido. consume() la borra.
    await this.cacheService.set({
      key: { prefix: CACHE_PREFIX, key: jti },
      data: { visitId },
      options: { ttl: TTL_SECONDS },
    });

    return token;
  }

  /**
   * Valida firma + expiración + tipo y que el token siga sin consumir.
   * Devuelve el payload verificado, o `null` si es inválido/expirado/ya usado.
   */
  async verify(token: string): Promise<VerifiedVisitAccessToken | null> {
    const secret = this.configService.get<string>('JWT_ACCESS_SECRET');

    let payload: VisitAccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<VisitAccessTokenPayload>(token, {
        secret,
        algorithms: ['HS256'],
      });
    } catch {
      return null; // firma inválida o expirado
    }

    if (payload.type !== TOKEN_TYPE || !payload.jti) return null;

    // Uso único: si la clave ya no existe, el token fue consumido (o expiró en cache).
    const record = await this.cacheService.get<{ visitId: string }>({
      key: { prefix: CACHE_PREFIX, key: payload.jti },
    });
    if (!record) return null;

    return { visitId: payload.visitId, visitorId: payload.visitorId, jti: payload.jti };
  }

  /** Invalida el token (uso único): tras esto cualquier verify() falla. */
  async consume(jti: string): Promise<void> {
    await this.cacheService.delete({ key: { prefix: CACHE_PREFIX, key: jti } });
  }
}
