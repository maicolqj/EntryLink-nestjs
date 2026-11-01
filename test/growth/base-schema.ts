// Esquema base de la base DESECHABLE de integración (ver docs/growth/TESTING.md).
// Crea public con synchronize (sin las entidades de growth) y marca como
// aplicadas las migraciones anteriores a la suite; luego `yarn migration:run`.
import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { DataSource } from 'typeorm';

const SRC = join(__dirname, '../../src');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const f = join(d, n);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });

(async () => {
  const entities = walk(SRC).filter(
    (f) =>
      f.endsWith('.entity.ts') &&
      !f.split(sep).join('/').includes('/modules/growth/'),
  );
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.GROWTH_IT_DATABASE_URL,
    entities,
    synchronize: false,
  });
  await ds.initialize();
  const [{ db }] = await ds.query('SELECT current_database() AS db');
  if (!/test/.test(db)) throw new Error('no es base de prueba');
  await ds.query('CREATE EXTENSION IF NOT EXISTS postgis');
  await ds.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await ds.synchronize();
  await ds.query(
    `CREATE TABLE IF NOT EXISTS migrations (id SERIAL PRIMARY KEY, "timestamp" bigint NOT NULL, name varchar NOT NULL)`,
  );
  const dir = join(SRC, 'core/database/migrations');
  let n = 0;
  for (const file of readdirSync(dir).sort()) {
    const ts = Number(file.split('-')[0]);
    if (!(ts < 1781010000000)) continue;
    const m = /export class (\w+)/.exec(readFileSync(join(dir, file), 'utf8'));
    if (!m) continue;
    await ds.query(
      `INSERT INTO migrations ("timestamp", name) VALUES ($1, $2)`,
      [ts, m[1]],
    );
    n++;
  }
  console.log(`entidades ${entities.length}, migraciones marcadas ${n}`);
  await ds.destroy();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
