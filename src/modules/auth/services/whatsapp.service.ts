import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

interface MetaApiResponse {
  messages?: { id: string }[];
  error?: { message: string; code: number; fbtrace_id?: string };
}

/**
 * Cliente de WhatsApp Cloud API (Meta) para envío de códigos de acceso.
 *
 * Requiere plantillas aprobadas en Meta Business Manager de categoría
 * "authentication": el body lleva {{1}} = código y el botón copy-code
 * recibe el mismo código como parámetro.
 *
 * Si las variables WHATSAPP_* no están configuradas el servicio queda
 * deshabilitado (isEnabled = false) y el caller decide el fallback;
 * así el backend puede arrancar en entornos sin credenciales de Meta.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly baseUrl: string | null = null;
  private readonly accessToken: string | null = null;
  private readonly otpTemplate: string;
  private readonly systemCodeTemplate: string;
  private readonly templateLang: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    const phoneNumberId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
    const accessToken = this.config.get<string>('WHATSAPP_ACCESS_TOKEN');
    const apiVersion = this.config.get<string>('WHATSAPP_API_VERSION', 'v21.0');

    this.otpTemplate = this.config.get<string>('WHATSAPP_OTP_TEMPLATE_NAME', 'remotelink_otp');
    this.systemCodeTemplate = this.config.get<string>('WHATSAPP_CODE_TEMPLATE_NAME', 'remotelink_access_code');
    this.templateLang = this.config.get<string>('WHATSAPP_TEMPLATE_LANG', 'es');

    if (phoneNumberId && accessToken) {
      this.accessToken = accessToken;
      this.baseUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
    } else {
      this.logger.warn(
        'WhatsApp Cloud API sin configurar (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN). Envíos deshabilitados.',
      );
    }
  }

  get isEnabled(): boolean {
    return this.baseUrl !== null;
  }

  /** Envía el OTP temporal (login por teléfono). */
  async sendOtp(phoneNumber: string, code: string): Promise<void> {
    await this.sendAuthTemplate(phoneNumber, this.otpTemplate, code);
  }

  /** Envía el código de sistema del residente (RES-XXXXX) para login identidad+código. */
  async sendSystemCode(phoneNumber: string, systemCode: string): Promise<void> {
    await this.sendAuthTemplate(phoneNumber, this.systemCodeTemplate, systemCode);
  }

  // ── Privados ──────────────────────────────────────────────────────────────

  private async sendAuthTemplate(phoneNumber: string, templateName: string, code: string): Promise<void> {
    if (!this.baseUrl || !this.accessToken) {
      throw new Error('WhatsApp Cloud API no está configurado (faltan variables WHATSAPP_*)');
    }

    const to = this.normalizePhone(phoneNumber);

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: this.templateLang },
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: code }],
          },
          // Las plantillas de categoría "authentication" exigen el parámetro
          // del botón copy-code además del body.
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: code }],
          },
        ],
      },
    };

    try {
      const { data } = await firstValueFrom(
        this.http.post<MetaApiResponse>(this.baseUrl, payload, {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        }),
      );

      if (data?.error) {
        throw new Error(
          `Meta API error ${data.error.code}: ${data.error.message}` +
          (data.error.fbtrace_id ? ` [trace: ${data.error.fbtrace_id}]` : ''),
        );
      }

      const msgId = data?.messages?.[0]?.id ?? 'unknown';
      this.logger.log(`WhatsApp "${templateName}" enviado → ${this.maskPhone(to)} | msgId: ${msgId}`);
    } catch (err: any) {
      const detail = err?.response?.data?.error?.message ?? err?.message ?? String(err);
      this.logger.error(`Error enviando WhatsApp "${templateName}" a ${this.maskPhone(to)}: ${detail}`);
      throw err;
    }
  }

  private normalizePhone(phone: string): string {
    const cleaned = phone.replace(/[\s\-().+]/g, '');
    if (cleaned.startsWith('57') && cleaned.length >= 11) return cleaned;
    return `57${cleaned}`;
  }

  private maskPhone(phone: string): string {
    return phone.replace(/\d{6}$/, '******');
  }
}
