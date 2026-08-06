import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Token de un solo propósito para confirmar la ENTREGA de una alerta de pánico.
 *
 * El ACK de entrega lo dispara Kotlin con OkHttp mientras la sirena ya está
 * sonando, con la app posiblemente muerta y sin sesión cargada: exigir el JWT
 * del usuario obligaría a leer el almacenamiento seguro y renovar el token
 * antes de poder avisar, justo en el peor momento. Por eso el permiso viaja
 * dentro del propio payload FCM.
 *
 * Es HMAC y no JWT a propósito: no hay nada que firmar salvo el par
 * (alerta, vencimiento), no necesita librería, y el token queda corto — importa
 * porque el payload de datos de FCM tiene un límite de 4 KB.
 *
 * Lo que este token autoriza es mínimo: marcar como entregada UNA alerta
 * concreta, algo idempotente y sin valor para un atacante. No sirve para leer
 * nada ni para reconocerla, que sigue exigiendo sesión.
 */
@Injectable()
export class PanicAckTokenService implements OnModuleInit {
  private readonly logger = new Logger(PanicAckTokenService.name);

  /** Ventana amplia respecto al TTL de 60s del push: el equipo pudo recibir la
   *  alerta tarde, reintentar sin red, o tener el reloj corrido. Un token viejo
   *  no hace daño porque solo confirma una entrega que de todos modos ocurrió. */
  private static readonly TTL_SECONDS = 15 * 60;

  private secret = '';

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    // Secreto propio si existe; si no, se reusa el de acceso para no exigir una
    // variable de entorno nueva en cada despliegue.
    this.secret =
      this.configService.get<string>('PANIC_ACK_SECRET') ??
      this.configService.get<string>('JWT_ACCESS_SECRET') ??
      '';

    if (!this.secret) {
      this.logger.error(
        'Sin PANIC_ACK_SECRET ni JWT_ACCESS_SECRET: los ACK de entrega de pánico se rechazarán todos.',
      );
    }
  }

  /** Token para una alerta. Formato: `<epochVencimiento>.<hmacHex>`. */
  sign(panicAlertId: string): string {
    const exp = Math.floor(Date.now() / 1000) + PanicAckTokenService.TTL_SECONDS;
    return `${exp}.${this.digest(panicAlertId, exp)}`;
  }

  /** Valida un token contra su alerta. Nunca lanza: devuelve true o false. */
  verify(panicAlertId: string, token: string | undefined): boolean {
    if (!this.secret || !token) return false;

    const separator = token.indexOf('.');
    if (separator <= 0) return false;

    const exp = Number(token.slice(0, separator));
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;

    const provided = token.slice(separator + 1);
    const expected = this.digest(panicAlertId, exp);

    // Comparación en tiempo constante; Buffer.from de largos distintos rompería
    // timingSafeEqual, así que se descarta antes por longitud.
    if (provided.length !== expected.length) return false;
    try {
      return timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  private digest(panicAlertId: string, exp: number): string {
    return createHmac('sha256', this.secret).update(`${panicAlertId}:${exp}`).digest('hex');
  }
}
