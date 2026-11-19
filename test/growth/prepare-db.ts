// Recrea DESDE CERO la base desechable de integración (ver docs/growth/TESTING.md):
// la borra, la crea, arma el esquema base y corre las migraciones.
//
// Las pruebas de `growth-db` verifican lo que dejan las migraciones (roles y
// permisos de la suite INACTIVOS, triggers, CHECK…). Una base reutilizada para
// probar a mano, por ejemplo con los permisos activados para el navegador, ya
// no representa ese estado. Por eso la suite completa corre sobre una base
// recién preparada, y las pruebas manuales usan otra base.
//
// Solo acepta un Postgres local y un nombre de base que termine en `_test`.
import { execSync } from 'node:child_process';
import { Client } from 'pg';

(async () => {
  const raw = process.env.GROWTH_IT_DATABASE_URL;
  if (!raw) throw new Error('Falta GROWTH_IT_DATABASE_URL');
  const url = new URL(raw);
  const db = decodeURIComponent(url.pathname.slice(1));
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error(`Solo se recrea una base local (host: ${url.hostname})`);
  }
  if (!/^[a-z0-9_]+_test$/.test(db)) {
    throw new Error(`El nombre de la base debe terminar en _test (es "${db}")`);
  }

  const maintenance = new URL(raw);
  maintenance.pathname = '/postgres';
  const admin = new Client({ connectionString: maintenance.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${db}"`);
  await admin.end();
  console.log(`base ${db} recreada`);

  const run = (cmd: string, env: NodeJS.ProcessEnv) =>
    execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
  run('npx ts-node -T test/growth/base-schema.ts', {});
  run('yarn migration:run', {
    DB_HOST: url.hostname,
    DB_PORT: url.port || '5432',
    DB_USERNAME: decodeURIComponent(url.username),
    PASSDB_POSTGRES: decodeURIComponent(url.password),
    DB_NAME: db,
  });
  console.log(
    'lista: base de integración en el estado que dejan las migraciones',
  );
})().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
