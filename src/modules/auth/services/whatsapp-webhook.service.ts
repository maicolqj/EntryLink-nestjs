import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Error que Meta adjunta a un status `failed`. */
interface MetaStatusError {
  code: number;
  title?: string;
  message?: string;
  href?: string;
  error_data?: { details?: string };
}

/** Un status de entrega dentro de `value.statuses`. */
interface MetaMessageStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp?: string;
  recipient_id?: string;
  errors?: MetaStatusError[];
}

interface MetaWebhookValue {
  statuses?: MetaMessageStatus[];
  messages?: unknown[];
  metadata?: { display_phone_number?: string; phone_number_id?: string };
}

export interface MetaWebhookPayload {
  object?: string;
  entry?: {
    id?: string;
    changes?: { field?: string; value?: MetaWebhookValue }[];
  }[];
}

/**
 * Procesa los callbacks de WhatsApp Cloud API.
 *
 * Meta responde `message_status: "accepted"` al POST de envío, lo que solo
 * significa "encolado". El resultado real (`sent` → `delivered` → `read`, o
 * `failed` con su código de error) llega exclusivamente por este webhook.
 * Sin él, un mensaje que Meta descarta es indistinguible de uno entregado.
 *
 * Los statuses se escriben a logs con el prefijo [WA-STATUS] para poder
 * filtrarlos en Coolify: `docker logs <container> | grep WA-STATUS`.
 */
@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new Logger(WhatsAppWebhookService.name);
  private readonly verifyToken: string | undefined;
  private readonly appSecret: string | undefined;

  constructor(private readonly config: ConfigService) {
    this.verifyToken = this.config.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
    this.appSecret = this.config.get<string>('WHATSAPP_APP_SECRET');

    if (!this.verifyToken) {
      this.logger.warn(
        'WHATSAPP_WEBHOOK_VERIFY_TOKEN sin configurar: el handshake de verificación de Meta será rechazado.',
      );
    }

    if (!this.appSecret) {
      this.logger.warn(
        'WHATSAPP_APP_SECRET sin configurar: no se valida la firma X-Hub-Signature-256 de los callbacks.',
      );
    }
  }

  /**
   * Handshake de verificación (GET). Meta lo llama una vez al guardar la URL
   * en el panel y espera el `hub.challenge` de vuelta en texto plano.
   */
  verifySubscription(mode?: string, token?: string): boolean {
    if (!this.verifyToken) return false;
    if (mode !== 'subscribe') return false;

    return this.safeCompare(token ?? '', this.verifyToken);
  }

  /**
   * Valida la firma HMAC-SHA256 del body crudo.
   *
   * Devuelve true cuando no hay `WHATSAPP_APP_SECRET` configurado: así el
   * webhook sigue reportando statuses durante el montaje inicial en vez de
   * devolver 401 y provocar que Meta deshabilite la suscripción. Configurar
   * el secret es obligatorio para producción.
   */
  isSignatureValid(signatureHeader: string | undefined, rawBody: Buffer | undefined): boolean {
    if (!this.appSecret) return true;

    if (!signatureHeader?.startsWith('sha256=') || !rawBody) return false;

    const expected = createHmac('sha256', this.appSecret).update(rawBody).digest('hex');

    return this.safeCompare(signatureHeader.slice('sha256='.length), expected);
  }

  /** Recorre el payload y loguea cada status; los `failed` con su código Meta. */
  processPayload(payload: MetaWebhookPayload): void {
    const statuses = (payload?.entry ?? [])
      .flatMap((entry) => entry?.changes ?? [])
      .flatMap((change) => change?.value?.statuses ?? []);

    if (statuses.length === 0) {
      // Los callbacks de mensajes entrantes (`value.messages`) también llegan
      // aquí; no se procesan todavía, solo se anotan.
      this.logger.debug('[WA-STATUS] Callback sin statuses de entrega (probable mensaje entrante)');
      return;
    }

    for (const status of statuses) {
      const to = this.maskPhone(status.recipient_id ?? 'desconocido');
      const base = `[WA-STATUS] ${status.status.toUpperCase()} → ${to} | msgId: ${status.id}`;

      if (status.status !== 'failed') {
        this.logger.log(base);
        continue;
      }

      const errors = status.errors ?? [];

      if (errors.length === 0) {
        this.logger.error(`${base} | sin detalle de error`);
        continue;
      }

      for (const err of errors) {
        const details = err.error_data?.details ?? err.message ?? 'sin detalle';
        this.logger.error(`${base} | code ${err.code} (${err.title ?? 'sin título'}): ${details}`);
      }
    }
  }

  // ── Privados ──────────────────────────────────────────────────────────────

  /** Comparación en tiempo constante, tolerante a longitudes distintas. */
  private safeCompare(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');

    if (bufA.length !== bufB.length) return false;

    return timingSafeEqual(bufA, bufB);
  }

  private maskPhone(phone: string): string {
    return phone.replace(/\d{6}$/, '******');
  }
}
