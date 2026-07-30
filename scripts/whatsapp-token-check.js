/**
 * Diagnóstico del token de WhatsApp Cloud API.
 * Nunca imprime el valor del token, solo su forma (longitud, prefijo, caracteres sospechosos).
 *
 * Uso: yarn whatsapp:token-check
 */
require('dotenv/config');

const vars = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'WHATSAPP_TEMPLATE_LANG',
  'WHATSAPP_OTP_TEMPLATE_NAME',
  'WHATSAPP_CODE_TEMPLATE_NAME',
  'WHATSAPP_API_VERSION',
];

console.log('--- Variables WHATSAPP_* en .env local ---\n');

for (const name of vars) {
  const raw = process.env[name];

  if (raw === undefined) {
    console.log(`${name}: AUSENTE`);
    continue;
  }

  if (name === 'WHATSAPP_ACCESS_TOKEN') {
    console.log(`${name}:`, {
      longitud: raw.length,
      prefijo: raw.slice(0, 4),
      tieneEspaciosOSaltos: /\s/.test(raw),
      tieneComillas: /["']/.test(raw),
      espaciosEnBordes: raw !== raw.trim(),
    });
    continue;
  }

  // El resto no son secretos: se muestran tal cual para verificar valores.
  console.log(`${name}: "${raw}"`);
}

console.log('\nEsperado para el token: longitud > 180, prefijo "EAA", los tres booleanos en false.');
console.log('Esperado para WHATSAPP_TEMPLATE_LANG: "es_CO" (no "es").');
