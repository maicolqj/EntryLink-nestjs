import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';

import { WhatsAppWebhookService, MetaWebhookPayload } from './whatsapp-webhook.service';
import { WhatsAppLoginService } from './whatsapp-login.service';

/**
 * La firma X-Hub-Signature-256 es lo único que distingue un callback de Meta
 * de uno fabricado. Desde que el webhook procesa mensajes entrantes, aceptar
 * uno sin firma equivale a dejar que cualquiera confirme un login ajeno.
 */
describe('WhatsAppWebhookService', () => {
  const APP_SECRET = 'app-secret-de-prueba';

  const loginService = { confirmFromInboundMessage: jest.fn(async () => undefined) };

  const build = async (env: Record<string, string | undefined>) => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        WhatsAppWebhookService,
        { provide: WhatsAppLoginService, useValue: loginService },
        { provide: ConfigService, useValue: { get: (k: string) => env[k] } },
      ],
    }).compile();

    return module.get(WhatsAppWebhookService);
  };

  const body = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account' }));
  const sign = (secret: string, raw: Buffer) =>
    `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  describe('con WHATSAPP_APP_SECRET configurado', () => {
    it('acepta el callback con firma válida', async () => {
      const service = await build({ WHATSAPP_APP_SECRET: APP_SECRET, NODE_ENV: 'production' });

      expect(service.isSignatureValid(sign(APP_SECRET, body), body)).toBe(true);
    });

    it('rechaza la firma de otro secreto', async () => {
      const service = await build({ WHATSAPP_APP_SECRET: APP_SECRET, NODE_ENV: 'production' });

      expect(service.isSignatureValid(sign('otro-secreto', body), body)).toBe(false);
    });

    it('rechaza el callback sin header de firma', async () => {
      const service = await build({ WHATSAPP_APP_SECRET: APP_SECRET, NODE_ENV: 'production' });

      expect(service.isSignatureValid(undefined, body)).toBe(false);
    });

    it('rechaza si el body fue alterado tras firmarse', async () => {
      const service = await build({ WHATSAPP_APP_SECRET: APP_SECRET, NODE_ENV: 'production' });
      const signature = sign(APP_SECRET, body);

      expect(service.isSignatureValid(signature, Buffer.from('{"object":"alterado"}'))).toBe(false);
    });
  });

  describe('sin WHATSAPP_APP_SECRET', () => {
    it('en producción rechaza todo callback', async () => {
      const service = await build({ NODE_ENV: 'production' });

      expect(service.isSignatureValid(sign(APP_SECRET, body), body)).toBe(false);
      expect(service.isSignatureValid(undefined, body)).toBe(false);
    });

    it('fuera de producción acepta, para poder montar el webhook en local', async () => {
      const service = await build({ NODE_ENV: 'development' });

      expect(service.isSignatureValid(undefined, body)).toBe(true);
    });
  });

  describe('despacho del payload', () => {
    const inbound: MetaWebhookPayload = {
      entry: [{
        changes: [{
          value: { messages: [{ from: '573001234567', type: 'text', text: { body: 'INGRESAR K7P3MQ2X' } }] },
        }],
      }],
    };

    it('deriva los mensajes entrantes al flujo de login', async () => {
      const service = await build({ NODE_ENV: 'development' });

      await service.processPayload(inbound);

      expect(loginService.confirmFromInboundMessage).toHaveBeenCalledWith(
        '573001234567', 'INGRESAR K7P3MQ2X',
      );
    });

    it('un fallo procesando el mensaje no se propaga (Meta debe recibir 200)', async () => {
      const service = await build({ NODE_ENV: 'development' });
      loginService.confirmFromInboundMessage.mockRejectedValueOnce(new Error('BD caída') as never);

      await expect(service.processPayload(inbound)).resolves.toBeUndefined();
    });

    it('un callback de statuses no toca el flujo de login', async () => {
      const service = await build({ NODE_ENV: 'development' });

      await service.processPayload({
        entry: [{ changes: [{ value: { statuses: [{ id: 'msg-1', status: 'delivered' }] } }] }],
      });

      expect(loginService.confirmFromInboundMessage).not.toHaveBeenCalled();
    });
  });
});
