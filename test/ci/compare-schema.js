#!/usr/bin/env node
/**
 * Compara dos esquemas GraphQL por su contenido, no por el orden en que Nest
 * escribe los tipos: los dos se ordenan y se comparan línea a línea.
 *
 * Uso: node test/ci/compare-schema.js <versionado> <generado>
 * Sale con 1 si difieren, y dice qué sobra y qué falta.
 *
 * Así se escapó en #280 y #281 que src/schema.gql no tenía los dos permisos
 * nuevos del enum ValidPermissions.
 */
const { readFileSync } = require('node:fs');
const {
  buildSchema,
  lexicographicSortSchema,
  printSchema,
} = require('graphql');

const [committed, generated] = process.argv.slice(2);
if (!committed || !generated) {
  console.error('Uso: node test/ci/compare-schema.js <versionado> <generado>');
  process.exit(2);
}

const lines = (file) =>
  printSchema(
    lexicographicSortSchema(buildSchema(readFileSync(file, 'utf8'))),
  ).split('\n');

const a = lines(committed);
const b = lines(generated);
const inA = new Set(a);
const inB = new Set(b);
const missing = b.filter((l) => !inA.has(l));
const extra = a.filter((l) => !inB.has(l));

if (!missing.length && !extra.length) {
  console.log('schema.gql coincide con el esquema que genera la API.');
  process.exit(0);
}
console.error('schema.gql NO coincide con el esquema que genera la API.');
console.error('Falta en el archivo versionado:');
missing.slice(0, 50).forEach((l) => console.error(`  + ${l}`));
console.error('Sobra en el archivo versionado:');
extra.slice(0, 50).forEach((l) => console.error(`  - ${l}`));
console.error(
  'Regenerarlo: arrancar la API en desarrollo (GROWTH_ENABLED apagada) y versionar src/schema.gql.',
);
process.exit(1);
