/**
 * Diagnóstico de la configuración de WhatsApp Cloud API en el entorno actual.
 *
 * Nunca imprime el valor de un secreto: de esos solo reporta su forma
 * (longitud, prefijo, caracteres sospechosos). Los identificadores y nombres
 * de plantilla no son secretos y se muestran tal cual para poder compararlos
 * contra el panel de Meta.
 *
 * Uso: yarn whatsapp:token-check
 */
require('dotenv/config');

/**
 * secreto → se reporta solo la forma.
 * check   → devuelve el problema encontrado, o null si el valor es plausible.
 */
const VARS = [
  {
    name: 'WHATSAPP_ACCESS_TOKEN',
    secreto: true,
    esperado: 'longitud mayor a 180 y prefijo "EAA"',
    check: (v) =>
      v.length > 180 && v.startsWith('EAA') ? null : 'longitud o prefijo inesperados',
  },
  {
    name: 'WHATSAPP_APP_SECRET',
    secreto: true,
    esperado: '32 caracteres hexadecimales (Meta → App settings → Basic → App secret)',
    check: (v) => (/^[0-9a-f]{32}$/i.test(v) ? null : 'no son 32 caracteres hexadecimales'),
  },
  {
    name: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    secreto: true,
    esperado: 'al menos 16 caracteres; debe ser idéntica a la del panel de Meta',
    check: (v) => (v.length >= 16 ? null : 'demasiado corta, genera una más larga'),
  },
  { name: 'WHATSAPP_PHONE_NUMBER_ID' },
  { name: 'WHATSAPP_BUSINESS_ACCOUNT_ID' },
  {
    name: 'WHATSAPP_TEMPLATE_LANG',
    esperado: 'es_CO',
    check: (v) => (v === 'es_CO' ? null : 'debe ser es_CO exacto, o Meta responde error 132001'),
  },
  { name: 'WHATSAPP_OTP_TEMPLATE_NAME' },
  { name: 'WHATSAPP_CODE_TEMPLATE_NAME' },
  { name: 'WHATSAPP_API_VERSION' },
];

/** Basura que rompe el valor aunque a simple vista se vea bien. */
function suciedad(raw) {
  const hallazgos = [];

  if (raw !== raw.trim()) hallazgos.push('espacios o saltos en los bordes');
  if (/\s/.test(raw.trim())) hallazgos.push('espacios o saltos internos');
  if (/["']/.test(raw)) hallazgos.push('comillas incrustadas en el valor');

  return hallazgos;
}

console.log('\n--- Configuración WHATSAPP_* del entorno actual ---\n');

const problemas = [];

for (const { name, secreto, esperado, check } of VARS) {
  const raw = process.env[name];

  if (raw === undefined || raw === '') {
    console.log(`${name}: AUSENTE`);
    problemas.push(`${name}: sin definir${esperado ? ` — se espera ${esperado}` : ''}`);
    continue;
  }

  if (secreto) {
    console.log(`${name}:`, {
      longitud: raw.length,
      prefijo: raw.slice(0, 4),
    });
  } else {
    console.log(`${name}: "${raw}"`);
  }

  for (const hallazgo of suciedad(raw)) {
    problemas.push(`${name}: ${hallazgo}`);
  }

  const problema = check?.(raw.trim());
  if (problema) problemas.push(`${name}: ${problema}`);
}

console.log('\n--- Resumen ---\n');

if (problemas.length === 0) {
  console.log('Sin problemas detectados en la forma de los valores.');
  console.log('Que el formato sea correcto no garantiza que las credenciales sean válidas:');
  console.log('para eso, `yarn whatsapp:send-test code <numero>` y revisar los logs [WA-STATUS].');
} else {
  console.log(`${problemas.length} problema(s) detectado(s):\n`);
  for (const p of problemas) console.log(`  - ${p}`);
  console.log('\nCorregirlos en el .env local y también en las variables de Coolify.');
  console.log('Tras cambiarlas en Coolify hace falta Redeploy: no se recargan en caliente.');
}

console.log('');
