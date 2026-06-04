/**
 * Envía el query-manifest.json del frontend al endpoint de sincronización
 * del backend (actualiza Redis sin necesidad de redeploy).
 *
 * Uso:
 *   node scripts/sync-manifest.js <API_URL> <GRAPHQL_SYNC_SECRET>
 *
 * Ejemplo:
 *   node scripts/sync-manifest.js https://api.alternaqj.com miSecretoAqui
 */

const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

const [,, apiUrl, secret] = process.argv;

if (!apiUrl || !secret) {
  console.error('Uso: node scripts/sync-manifest.js <API_URL> <GRAPHQL_SYNC_SECRET>');
  process.exit(1);
}

const manifestPath = path.join(__dirname, '..', 'query-manifest.json'); // generado por codegen del frontend
const manifest     = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
const body         = JSON.stringify(manifest);
const url          = new URL('/api/v1/graphql-manifest/sync', apiUrl);
const isHttps      = url.protocol === 'https:';
const lib          = isHttps ? https : http;

const options = {
  hostname: url.hostname,
  port:     url.port || (isHttps ? 443 : 80),
  path:     url.pathname,
  method:   'POST',
  headers: {
    'Content-Type':   'application/json',
    'Content-Length': Buffer.byteLength(body),
    'x-sync-secret': secret,
  },
};

const req = lib.request(options, res => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (json.ok) {
        console.log(`✓ Manifest sincronizado: ${json.synced} queries en Redis`);
      } else {
        console.error('✗ Respuesta inesperada:', data);
      }
    } catch {
      console.error('✗ Error parseando respuesta:', data);
    }
  });
});

req.on('error', err => { console.error('✗ Error de conexión:', err.message); });
req.write(body);
req.end();
