/**
 * Reproduce el handshake de verificación que Meta ejecuta contra el webhook,
 * y traduce el resultado a la causa concreta.
 *
 * Sirve para saber si el servidor está listo ANTES de registrar la Callback
 * URL en el panel de Meta, donde un fallo solo dice "couldn't be validated".
 *
 * Uso:
 *   yarn whatsapp:webhook-selftest                          → contra producción
 *   yarn whatsapp:webhook-selftest http://localhost:3001     → contra local
 */
require('dotenv/config');
const axios = require('axios');

const DEFAULT_BASE = 'https://api.alternaqj.com';
const PATH = '/api/v1/whatsapp/webhook';
const CHALLENGE = '12345';

const base = (process.argv[2] || DEFAULT_BASE).replace(/\/+$/, '');
const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

if (!verifyToken) {
  console.error('Falta WHATSAPP_WEBHOOK_VERIFY_TOKEN en el .env local.');
  console.error('Debe ser el MISMO valor que pusiste en Coolify.');
  process.exit(1);
}

const url = `${base}${PATH}`;

(async () => {
  console.log(`Probando handshake contra ${url}\n`);

  try {
    const res = await axios.get(url, {
      params: {
        'hub.mode': 'subscribe',
        'hub.verify_token': verifyToken,
        'hub.challenge': CHALLENGE,
      },
      timeout: 15_000,
      // No lanzar por códigos de error: los interpretamos abajo.
      validateStatus: null,
      // El challenge llega en texto plano; sin esto axios intenta parsear JSON.
      transformResponse: [(d) => d],
    });

    const body = String(res.data ?? '').trim();
    console.log(`HTTP ${res.status}`);
    console.log(`Body: "${body}"\n`);

    if (res.status === 200 && body === CHALLENGE) {
      console.log('LISTO. El servidor devuelve el challenge correctamente.');
      console.log('Ya puedes registrar la Callback URL en el panel de Meta:');
      console.log(`  ${url}`);
      return;
    }

    if (res.status === 200 && body === 'forbidden') {
      console.log('El endpoint responde, pero rechazó el verify token.');
      console.log('Causa: WHATSAPP_WEBHOOK_VERIFY_TOKEN del contenedor no coincide con el de tu .env local.');
      console.log('Revisa el valor en Coolify (sin comillas, sin espacios) y haz Redeploy.');
      return;
    }

    if (res.status === 404) {
      console.log('404: el deploy con el webhook todavía no está corriendo en ese servidor.');
      console.log('Revisa `gh run list --limit 3` y el estado del deploy en Coolify.');
      return;
    }

    console.log('Respuesta inesperada. Revisa los logs de arranque del contenedor.');
  } catch (e) {
    const code = e.code ?? '';
    console.log(`Fallo de conexión: ${code || e.message}\n`);

    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
      console.log('Timeout: la app no responde. Puede estar caída o sin arrancar.');
    } else if (code === 'ENOTFOUND') {
      console.log('DNS no resuelve ese host. Verifica el dominio.');
    } else if (code === 'ECONNREFUSED') {
      console.log('Conexión rechazada: no hay nada escuchando en ese puerto.');
    } else if (e.response) {
      console.log(`HTTP ${e.response.status}`);
      console.log('502/503 suele ser la app caída detrás del proxy. Mira los logs del contenedor.');
    }
  }
})();
