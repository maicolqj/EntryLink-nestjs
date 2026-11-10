import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

import { IceServer } from '../dto/responses/ice-server.response';

const DEFAULT_TTL_SECONDS = 3600;

/**
 * Servidores STUN/TURN para las llamadas.
 *
 * El TURN es un coturn propio con `use-auth-secret`: no hay usuarios fijos, el
 * servidor firma credenciales que vencen solas (usuario = `vencimiento:userId`,
 * clave = HMAC-SHA1 del usuario con el secreto compartido, en base64). Así una
 * credencial filtrada deja de servir al cumplirse el TTL.
 *
 * Variables:
 * - INTERCOM_STUN_URLS   ej. stun:turn.alternaqj.com:3478
 * - INTERCOM_TURN_URLS   ej. turn:turn.alternaqj.com:3478?transport=udp,turns:turn.alternaqj.com:5349
 * - INTERCOM_TURN_SECRET el mismo `static-auth-secret` de coturn
 * - INTERCOM_TURN_TTL_SECONDS (opcional, 3600)
 *
 * Sin TURN configurado se devuelve solo STUN: la llamada funciona en la misma
 * red o con NAT sencillos, pero no detrás de NAT simétrico (datos móviles).
 */
@Injectable()
export class IceServersService {
  constructor(private readonly config: ConfigService) {}

  forUser(userId: string, now: Date = new Date()): IceServer[] {
    const servers: IceServer[] = [];

    const stun = this.list('INTERCOM_STUN_URLS');
    if (stun.length > 0) servers.push({ urls: stun });

    const turn = this.list('INTERCOM_TURN_URLS');
    const secret = this.config.get<string>('INTERCOM_TURN_SECRET');
    if (turn.length > 0 && secret) {
      const ttl =
        Number(this.config.get('INTERCOM_TURN_TTL_SECONDS')) ||
        DEFAULT_TTL_SECONDS;
      const expiresAt = Math.floor(now.getTime() / 1000) + ttl;
      const username = `${expiresAt}:${userId}`;
      const credential = createHmac('sha1', secret)
        .update(username)
        .digest('base64');
      servers.push({ urls: turn, username, credential });
    }

    return servers;
  }

  private list(key: string): string[] {
    return (this.config.get<string>(key) ?? '')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);
  }
}
