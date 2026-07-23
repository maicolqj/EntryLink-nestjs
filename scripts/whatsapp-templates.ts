/**
 * Gestión de plantillas de WhatsApp Cloud API (Meta) para códigos de acceso.
 *
 * Crea/lista/elimina las plantillas de categoría "authentication" que el
 * backend usa para enviar el OTP de login y el código de sistema del residente
 * (RES-xxxxx). Estas plantillas deben existir y estar APROBADAS por Meta antes
 * de que WhatAppService.sendOtp / sendSystemCode funcionen en producción.
 *
 * Uso:
 *   yarn whatsapp:templates create   # crea las 2 plantillas (idempotente)
 *   yarn whatsapp:templates list     # lista plantillas de la cuenta + estado
 *   yarn whatsapp:templates delete   # elimina las 2 plantillas por nombre
 *
 * Variables de entorno necesarias (ver .env.example):
 *   WHATSAPP_ACCESS_TOKEN          Token con permiso whatsapp_business_management
 *   WHATSAPP_BUSINESS_ACCOUNT_ID   WABA ID (distinto del PHONE_NUMBER_ID de envío)
 *   WHATSAPP_API_VERSION           default v21.0
 *   WHATSAPP_OTP_TEMPLATE_NAME     default remotelink_otp
 *   WHATSAPP_CODE_TEMPLATE_NAME    default remotelink_access_code
 *   WHATSAPP_TEMPLATE_LANG         default es
 */
import 'dotenv/config';
import axios, { AxiosError } from 'axios';

// ── Config desde entorno ──────────────────────────────────────────────────
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';
const OTP_TEMPLATE = process.env.WHATSAPP_OTP_TEMPLATE_NAME || 'remotelink_otp';
const CODE_TEMPLATE = process.env.WHATSAPP_CODE_TEMPLATE_NAME || 'remotelink_access_code';
const LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'es';

// Vigencia mostrada en el footer del OTP (coincide con AUTH_CONSTANTS.OTP_EXPIRY_SECONDS = 5 min).
const OTP_EXPIRATION_MINUTES = 5;

interface TemplateComponent {
  type: 'BODY' | 'FOOTER' | 'BUTTONS';
  add_security_recommendation?: boolean;
  code_expiration_minutes?: number;
  buttons?: { type: 'OTP'; otp_type: 'COPY_CODE' }[];
}

interface TemplateDefinition {
  name: string;
  language: string;
  category: 'AUTHENTICATION';
  components: TemplateComponent[];
}

/**
 * Construye una plantilla de categoría "authentication".
 *
 * En esta categoría Meta genera el texto del body automáticamente (no se puede
 * personalizar); solo se controla:
 *   - add_security_recommendation: agrega la línea "no compartas este código".
 *   - FOOTER.code_expiration_minutes: agrega "el código caduca en N minutos".
 *   - botón OTP COPY_CODE: botón de un toque para copiar el código.
 * Al enviar, el código va como parámetro del body {{1}} y del botón (así lo
 * hace WhatsAppService.sendAuthTemplate).
 */
function buildAuthTemplate(
  name: string,
  opts: { expirationMinutes?: number },
): TemplateDefinition {
  const components: TemplateComponent[] = [
    { type: 'BODY', add_security_recommendation: true },
  ];

  // El código de sistema (RES-xxxxx) no expira → se omite el footer de vigencia.
  if (opts.expirationMinutes) {
    components.push({ type: 'FOOTER', code_expiration_minutes: opts.expirationMinutes });
  }

  components.push({
    type: 'BUTTONS',
    buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }],
  });

  return { name, language: LANG, category: 'AUTHENTICATION', components };
}

const TEMPLATES: TemplateDefinition[] = [
  buildAuthTemplate(OTP_TEMPLATE, { expirationMinutes: OTP_EXPIRATION_MINUTES }),
  buildAuthTemplate(CODE_TEMPLATE, {}),
];

// ── Helpers HTTP ───────────────────────────────────────────────────────────
function baseUrl(): string {
  return `https://graph.facebook.com/${API_VERSION}/${WABA_ID}/message_templates`;
}

function authHeaders() {
  return { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' };
}

function metaError(err: unknown): string {
  const e = err as AxiosError<{ error?: { message: string; error_user_title?: string; error_user_msg?: string } }>;
  const apiErr = e.response?.data?.error;
  if (apiErr) {
    return apiErr.error_user_msg
      ? `${apiErr.error_user_title ?? 'Error'}: ${apiErr.error_user_msg}`
      : apiErr.message;
  }
  return e.message ?? String(err);
}

function assertConfig(): void {
  const missing: string[] = [];
  if (!ACCESS_TOKEN) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!WABA_ID) missing.push('WHATSAPP_BUSINESS_ACCOUNT_ID');
  if (missing.length) {
    console.error(`✖ Faltan variables de entorno: ${missing.join(', ')}`);
    console.error('  Definilas en .env antes de correr este script.');
    process.exit(1);
  }
}

// ── Comandos ───────────────────────────────────────────────────────────────
async function createTemplates(): Promise<void> {
  for (const tpl of TEMPLATES) {
    try {
      const { data } = await axios.post(baseUrl(), tpl, { headers: authHeaders() });
      console.log(`✔ "${tpl.name}" (${LANG}) creada → id: ${data.id}, estado: ${data.status ?? 'PENDING'}`);
    } catch (err) {
      const msg = metaError(err);
      // Meta responde con error si el nombre+idioma ya existe: se trata como no-fatal.
      if (/already exists/i.test(msg)) {
        console.log(`• "${tpl.name}" (${LANG}) ya existe — sin cambios`);
      } else {
        console.error(`✖ "${tpl.name}" (${LANG}): ${msg}`);
      }
    }
  }
  console.log('\nLas plantillas quedan en revisión de Meta (PENDING). El envío real');
  console.log('solo funciona cuando pasan a estado APPROVED (suele tardar minutos).');
}

async function listTemplates(): Promise<void> {
  try {
    const { data } = await axios.get(baseUrl(), {
      headers: authHeaders(),
      params: { fields: 'name,status,category,language', limit: 100 },
    });
    const rows: { name: string; status: string; category: string; language: string }[] = data.data ?? [];
    if (!rows.length) {
      console.log('(sin plantillas en la cuenta)');
      return;
    }
    console.log('NOMBRE'.padEnd(32), 'IDIOMA'.padEnd(8), 'CATEGORÍA'.padEnd(16), 'ESTADO');
    for (const t of rows) {
      console.log(
        t.name.padEnd(32),
        (t.language ?? '').padEnd(8),
        (t.category ?? '').padEnd(16),
        t.status,
      );
    }
  } catch (err) {
    console.error(`✖ No se pudo listar: ${metaError(err)}`);
    process.exit(1);
  }
}

async function deleteTemplates(): Promise<void> {
  for (const name of [OTP_TEMPLATE, CODE_TEMPLATE]) {
    try {
      await axios.delete(baseUrl(), { headers: authHeaders(), params: { name } });
      console.log(`✔ "${name}" eliminada`);
    } catch (err) {
      console.error(`✖ "${name}": ${metaError(err)}`);
    }
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const command = process.argv[2];
  assertConfig();

  switch (command) {
    case 'create':
      await createTemplates();
      break;
    case 'list':
      await listTemplates();
      break;
    case 'delete':
      await deleteTemplates();
      break;
    default:
      console.error('Comando inválido. Uso: yarn whatsapp:templates <create|list|delete>');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`✖ Error inesperado: ${metaError(err)}`);
  process.exit(1);
});
