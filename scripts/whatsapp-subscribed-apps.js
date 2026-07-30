/**
 * Consulta (y opcionalmente crea) la suscripción de la WABA a la app de Meta.
 *
 * Sin esta suscripción la app no recibe NINGÚN callback, por más que la
 * Callback URL esté verificada en el panel: son dos cosas distintas.
 *
 * Uso:
 *   yarn whatsapp:subscribed-apps              → consulta el estado
 *   yarn whatsapp:subscribed-apps --subscribe  → suscribe la WABA a la app
 */
require('dotenv/config');
const axios = require('axios');

const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WABA = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
const VER = process.env.WHATSAPP_API_VERSION || 'v21.0';

const subscribe = process.argv.includes('--subscribe');

if (!TOKEN || !WABA) {
  console.error('Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_BUSINESS_ACCOUNT_ID en el .env');
  process.exit(1);
}

const url = `https://graph.facebook.com/${VER}/${WABA}/subscribed_apps`;
const headers = { Authorization: `Bearer ${TOKEN}` };

(async () => {
  try {
    if (subscribe) {
      console.log(`Suscribiendo la WABA ${WABA} a la app...\n`);
      const { data } = await axios.post(url, null, { headers });
      console.log(JSON.stringify(data, null, 2));
      console.log('\nVuelve a ejecutar sin --subscribe para confirmar.');
      return;
    }

    console.log(`Consultando suscripciones de la WABA ${WABA}...\n`);
    const { data } = await axios.get(url, { headers });
    console.log(JSON.stringify(data, null, 2));

    const apps = data?.data ?? [];

    if (apps.length === 0) {
      console.log('\nLa WABA NO está suscrita a ninguna app: no llegará ningún webhook.');
      console.log('Ejecuta: yarn whatsapp:subscribed-apps --subscribe');
    } else {
      console.log(`\n${apps.length} app(s) suscrita(s). Los callbacks deberían llegar.`);
    }
  } catch (e) {
    const err = e.response?.data?.error;
    console.log('Error:', JSON.stringify(err ?? e.message, null, 2));

    if (err?.code === 190) {
      console.log('\ncode 190 = token inválido o expirado. Regenéralo en Business Settings → System Users.');
    }
  }
})();
