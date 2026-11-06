import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUPS,
  buildUrl,
  toRow,
  dedupeAcrossGroups,
  toCsv,
  buildCountUrl,
  assertComplete,
  assertRecords,
} from './rues-administradoras.lib.mjs';

test('GROUPS va en orden de confianza y todos filtran Bogotá, activas y NIT', () => {
  assert.deepEqual(
    GROUPS.map((g) => g.key),
    ['ciiu-principal-renovadas', 'ciiu-principal-antiguas', 'ciiu-secundaria', 'nombre-ph'],
  );
  for (const g of GROUPS) {
    assert.match(g.where, /codigo_camara='04'/);
    assert.match(g.where, /codigo_estado_matricula='01'/);
    assert.match(g.where, /codigo_clase_identificacion='02'/);
  }
});

test('buildUrl pide solo las columnas necesarias, ordena de forma estable y pagina', () => {
  const url = new URL(buildUrl(GROUPS[0].where, 2000));
  assert.equal(url.origin + url.pathname, 'https://www.datos.gov.co/resource/c82u-588k.json');
  assert.equal(url.searchParams.get('$offset'), '2000');
  assert.equal(url.searchParams.get('$limit'), '1000');
  assert.equal(url.searchParams.get('$order'), ':id');
  assert.match(url.searchParams.get('$where'), /codigo_camara='04'/);
  const select = url.searchParams.get('$select');
  assert.doesNotMatch(select, /representante/);
  assert.match(select, /razon_social/);
});

test('toRow arma el NIT con dígito, Bogotá y observaciones sin datos personales', () => {
  const row = toRow(
    {
      razon_social: 'ADMINISTRACIONES LA 80 SAS',
      nit: '900835212',
      digito_verificacion: '3',
      cod_ciiu_act_econ_pri: '8110',
      cod_ciiu_act_econ_sec: '6820',
      ultimo_ano_renovado: '2025',
      representante_legal: 'NO DEBE SALIR',
    },
    'CIIU principal 8110',
  );
  assert.deepEqual(row, {
    'Razón social': 'ADMINISTRACIONES LA 80 SAS',
    NIT: '900835212-3',
    Ciudad: 'Bogotá',
    Observaciones: 'RUES · CIIU 8110/6820 · CIIU principal 8110 · renovado 2025',
  });
});

test('toRow sin dígito ni secundaria ni año', () => {
  const row = toRow({ razon_social: 'X', nit: '800100200', cod_ciiu_act_econ_pri: '8110' }, 'g');
  assert.equal(row.NIT, '800100200');
  assert.equal(row.Observaciones, 'RUES · CIIU 8110/— · g · renovado —');
});

test('dedupeAcrossGroups deja cada NIT solo en el primer grupo', () => {
  const r = (nit) => ({ 'Razón social': nit, NIT: nit, Ciudad: 'Bogotá', Observaciones: '' });
  const out = dedupeAcrossGroups([
    { key: 'a', rows: [r('1-1'), r('2-2')] },
    { key: 'b', rows: [r('2-2'), r('3-3'), r('3-3')] },
  ]);
  assert.deepEqual(out.map((g) => g.rows.map((x) => x.NIT)), [['1-1', '2-2'], ['3-3']]);
});

test('toCsv: BOM, punto y coma, CRLF y comillas escapadas', () => {
  const csv = toCsv([
    { 'Razón social': 'ADMIN; "LA 80" S.A.S', NIT: '1-1', Ciudad: 'Bogotá', Observaciones: 'ok' },
  ]);
  assert.ok(csv.startsWith('﻿Razón social;NIT;Ciudad;Observaciones\r\n'));
  assert.ok(csv.includes('"ADMIN; ""LA 80"" S.A.S";1-1;Bogotá;ok\r\n'));
});

test('final #1: sin nit usa numero_identificacion; dedupe por NIT base', () => {
  const row = toRow(
    { razon_social: 'ADMINISTREMOS PROPIEDAD HORIZONTAL SAS', numero_identificacion: '900467909', digito_verificacion: '9', cod_ciiu_act_econ_pri: '8110' },
    'g',
  );
  assert.equal(row.NIT, '900467909-9');
  const r = (nit) => ({ 'Razón social': nit, NIT: nit, Ciudad: 'Bogotá', Observaciones: '' });
  const out = dedupeAcrossGroups([
    { key: 'a', rows: [r('900467909-9'), r(''), r('-3')] },
    { key: 'b', rows: [r('900467909'), r(''), r('-3')] },
  ]);
  // Mismo NIT base con y sin dígito = repetido; filas sin identificador no se colapsan.
  assert.deepEqual(out.map((g) => g.rows.map((x) => x.NIT)), [['900467909-9', '', '-3'], ['', '-3']]);
});

test('final #2: buildCountUrl y assertComplete detectan descargas incompletas', () => {
  const url = new URL(buildCountUrl(GROUPS[0].where));
  assert.equal(url.searchParams.get('$select'), 'count(*) AS n');
  assert.match(url.searchParams.get('$where'), /codigo_camara='04'/);
  assert.doesNotThrow(() => assertComplete('g', 3, 3));
  assert.throws(() => assertComplete('g', 3, 2), /incompleta/);
  assert.throws(() => assertComplete('g', 0, 0), /0 filas/);
  assert.throws(() => assertRecords([{ razon_social: 'X' }, 'basura']), /registro/);
  assert.doesNotThrow(() => assertRecords([{ razon_social: 'X' }]));
});

test('final #3: el orden de paginación es estable', () => {
  const url = new URL(buildUrl(GROUPS[0].where, 0));
  assert.equal(url.searchParams.get('$order'), ':id');
});

test('final #4: el grupo de nombre PH incluye CIIU principal NULL', () => {
  const g4 = GROUPS.find((g) => g.key === 'nombre-ph');
  assert.match(g4.where, /cod_ciiu_act_econ_pri IS NULL/);
});
