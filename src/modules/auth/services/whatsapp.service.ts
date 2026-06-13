// import { HttpService } from '@nestjs/axios';
// import { Injectable, Logger } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import { firstValueFrom } from 'rxjs';

// interface MetaApiResponse {
//   messages?: { id: string }[];
//   error?: { message: string; code: number; fbtrace_id?: string };
// }

// @Injectable()
// export class WhatsAppService {
//   private readonly logger = new Logger(WhatsAppService.name);
//   private readonly baseUrl: string;
//   private readonly accessToken: string;
//   private readonly templateName: string;
//   private readonly templateLang: string;

//   constructor(
//     private readonly http: HttpService,
//     private readonly config: ConfigService,a
//   ) {
//     const phoneNumberId = this.config.getOrThrow<string>('WHATSAPP_PHONE_NUMBER_ID');
//     const apiVersion    = this.config.get<string>('WHATSAPP_API_VERSION', 'v21.0');
//     this.accessToken    = this.config.getOrThrow<string>('WHATSAPP_ACCESS_TOKEN');
//     this.templateName   = this.config.get<string>('WHATSAPP_OTP_TEMPLATE_NAME', 'remotelink_otp');
//     this.templateLang   = this.config.get<string>('WHATSAPP_TEMPLATE_LANG', 'es');
//     this.baseUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
//   }

//   /**
//    * Envía el código OTP por WhatsApp usando una plantilla aprobada en Meta Business.
//    * La plantilla debe tener dos parámetros en el body: {{1}} = código, {{2}} = minutos.
//    * Ejemplo de texto: "Tu código EntryLink es: *{{1}}*. Válido por {{2}} minutos."
//    */
//   async sendOtp(phoneNumber: string, code: string, expiresInMinutes: number): Promise<void> {
//     const to = this.normalizePhone(phoneNumber);

//     const payload = {
//       messaging_product: 'whatsapp',
//       to,
//       type: 'template',
//       template: {
//         name: this.templateName,
//         language: { code: this.templateLang },
//         components: [
//           {
//             type: 'body',
//             parameters: [
//               { type: 'text', text: code },
//               { type: 'text', text: String(expiresInMinutes) },
//             ],
//           },
//         ],
//       },
//     };

//     try {
//       const { data } = await firstValueFrom(
//         this.http.post<MetaApiResponse>(this.baseUrl, payload, {
//           headers: {
//             Authorization: `Bearer ${this.accessToken}`,
//             'Content-Type': 'application/json',
//           },
//         }),
//       );

//       if (data?.error) {
//         throw new Error(
//           `Meta API error ${data.error.code}: ${data.error.message}` +
//           (data.error.fbtrace_id ? ` [trace: ${data.error.fbtrace_id}]` : ''),
//         );
//       }

//       const msgId = data?.messages?.[0]?.id ?? 'unknown';
//       this.logger.log(`WhatsApp OTP enviado → ${this.maskPhone(to)} | msgId: ${msgId}`);
//     } catch (err: any) {
//       const detail = err?.response?.data?.error?.message ?? err?.message ?? String(err);
//       this.logger.error(`Error enviando OTP por WhatsApp a ${this.maskPhone(to)}: ${detail}`);
//       throw err;
//     }
//   }

//   private normalizePhone(phone: string): string {
//     const cleaned = phone.replace(/[\s\-().+]/g, '');
//     if (cleaned.startsWith('57') && cleaned.length >= 11) return cleaned;
//     return `57${cleaned}`;
//   }

//   private maskPhone(phone: string): string {
//     return phone.replace(/\d{6}$/, '******');
//   }
// }
