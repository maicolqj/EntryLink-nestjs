import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';

import { Public } from '../../shared/decorators/public.decorator';
import {
  MetaWebhookPayload,
  WhatsAppWebhookService,
} from '../services/whatsapp-webhook.service';

/** Request de Express con el body crudo que guarda el verify de express.json (ver main.ts). */
type RawBodyRequest = Request & { rawBody?: Buffer };

/**
 * Webhook de WhatsApp Cloud API (Meta).
 *
 * Configuración en el panel de Meta (App → WhatsApp → Configuration → Webhook):
 *   Callback URL:  https://api.alternaqj.com/api/v1/whatsapp/webhook
 *   Verify token:  el valor de WHATSAPP_WEBHOOK_VERIFY_TOKEN
 *   Suscribirse al campo: `messages` (incluye los statuses de entrega)
 *
 * Endpoint público por diseño: Meta llama sin JWT. La autenticidad se valida
 * con el verify token (GET) y la firma HMAC del body (POST).
 */
@Controller('whatsapp')
@SkipThrottle()
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(private readonly webhookService: WhatsAppWebhookService) {}

  /**
   * GET /api/v1/whatsapp/webhook
   *
   * Handshake que Meta ejecuta al guardar la Callback URL. Debe devolver el
   * `hub.challenge` tal cual, en texto plano, o el panel rechaza la URL.
   */
  @Public()
  @Get('webhook')
  @Header('Content-Type', 'text/plain')
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    if (!this.webhookService.verifySubscription(mode, token)) {
      this.logger.warn('Handshake de webhook rechazado: hub.mode o hub.verify_token inválidos');
      return 'forbidden';
    }

    this.logger.log('Handshake de webhook de WhatsApp verificado correctamente');

    return challenge ?? '';
  }

  /**
   * POST /api/v1/whatsapp/webhook
   *
   * Recibe los statuses de entrega y los mensajes entrantes (estos últimos son
   * el canal del login reverse-OTP). Siempre responde 200: un no-2xx repetido
   * hace que Meta reintente en ráfaga y termine deshabilitando la suscripción,
   * así que los fallos de procesamiento se registran pero no se propagan.
   *
   * El body va sin DTO a propósito — el ValidationPipe global usa
   * forbidNonWhitelisted y rechazaría el payload de Meta, que trae muchos
   * campos no declarados.
   */
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receive(@Req() req: RawBodyRequest, @Body() payload: MetaWebhookPayload): Promise<string> {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    if (!this.webhookService.isSignatureValid(signature, req.rawBody)) {
      this.logger.warn('Callback de WhatsApp descartado: firma X-Hub-Signature-256 inválida');
      return 'EVENT_RECEIVED';
    }

    try {
      await this.webhookService.processPayload(payload);
    } catch (err: any) {
      this.logger.error(`Error procesando callback de WhatsApp: ${err?.message ?? String(err)}`);
    }

    return 'EVENT_RECEIVED';
  }
}
