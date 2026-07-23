/**
 * Envío de prueba — reproduce exactamente el payload de WhatsAppService.
 * Uso: yarn ts-node scripts/whatsapp-send-test.ts <otp|code> <telefonoDestino>
 * Ej:  yarn ts-node scripts/whatsapp-send-test.ts code 573001234567
 */
import 'dotenv/config';
import axios from 'axios';

const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN!;
const VER = process.env.WHATSAPP_API_VERSION || 'v21.0';
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID!;
const LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'es';
const OTP_TPL = process.env.WHATSAPP_OTP_TEMPLATE_NAME || 'remotelink_otp';
const CODE_TPL = process.env.WHATSAPP_CODE_TEMPLATE_NAME || 'remotelink_access_code';

const kind = process.argv[2];             // 'otp' | 'code'
const to = (process.argv[3] || '').replace(/[\s\-().+]/g, '');

if (!['otp', 'code'].includes(kind) || !to) {
  console.error('Uso: yarn ts-node scripts/whatsapp-send-test.ts <otp|code> <telefonoDestino>');
  process.exit(1);
}

const template = kind === 'otp' ? OTP_TPL : CODE_TPL;
// Código de muestra: para "code" usamos formato RES-xxxxx para probar el guion.
const sampleCode = kind === 'otp' ? '123456' : 'RES-A1B2C';

const payload = {
  messaging_product: 'whatsapp',
  to,
  type: 'template',
  template: {
    name: template,
    language: { code: LANG },
    components: [
      { type: 'body', parameters: [{ type: 'text', text: sampleCode }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: sampleCode }] },
    ],
  },
};

(async () => {
  console.log(`Enviando "${template}" (${LANG}) → ${to} | código muestra: ${sampleCode}`);
  try {
    const { data } = await axios.post(
      `https://graph.facebook.com/${VER}/${PHONE_ID}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } },
    );
    console.log('✔ Enviado:', JSON.stringify(data));
  } catch (e: any) {
    console.log('✖ Error:', JSON.stringify(e.response?.data?.error ?? e.message, null, 2));
  }
})();
