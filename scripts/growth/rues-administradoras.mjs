#!/usr/bin/env node
/**
 * Baja del RUES las administradoras de propiedad horizontal de Bogotá y
 * escribe un CSV por grupo, listo para /growth/importaciones.
 *
 *   node scripts/growth/rues-administradoras.mjs [carpeta-salida]
 *
 * Solo lee la API pública de datos.gov.co; no toca la base ni la API de la
 * plataforma. Ver scripts/growth/README-rues.md.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  GROUPS,
  PAGE_SIZE,
  MAX_ROWS_PER_FILE,
  buildUrl,
  buildCountUrl,
  assertComplete,
  assertRecords,
  toRow,
  dedupeAcrossGroups,
  toCsv,
} from './rues-administradoras.lib.mjs';

const outDir = resolve(process.argv[2] ?? 'rues-salida');

async function fetchPage(url) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new Error(`Sin conexión con datos.gov.co: ${e.message}`);
  }
  if (!res.ok) {
    throw new Error(`datos.gov.co respondió ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body = await res.json().catch(() => null);
  if (!Array.isArray(body)) throw new Error('datos.gov.co devolvió algo que no es una lista');
  return body;
}

async function fetchGroup(group) {
  const [{ n } = {}] = await fetchPage(buildCountUrl(group.where));
  const expected = Number(n);
  if (!Number.isInteger(expected)) throw new Error(`No se pudo contar «${group.label}»`);
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchPage(buildUrl(group.where, offset));
    assertRecords(page);
    rows.push(...page.map((rec) => toRow(rec, group.label)));
    if (page.length < PAGE_SIZE) break;
  }
  assertComplete(group.label, expected, rows.length);
  return rows;
}

function chunks(rows) {
  if (rows.length <= MAX_ROWS_PER_FILE) return [rows];
  const out = [];
  for (let i = 0; i < rows.length; i += MAX_ROWS_PER_FILE) out.push(rows.slice(i, i + MAX_ROWS_PER_FILE));
  return out;
}

async function main() {
  const raw = [];
  for (const group of GROUPS) {
    process.stdout.write(`Consultando «${group.label}»… `);
    const rows = await fetchGroup(group);
    console.log(rows.length);
    raw.push({ ...group, rows });
  }
  const groups = dedupeAcrossGroups(raw);

  // Todo se arma en memoria antes de escribir: un fallo a mitad no deja archivos parciales.
  const files = [];
  groups.forEach((g, i) => {
    const parts = chunks(g.rows);
    parts.forEach((rows, p) => {
      const suffix = parts.length > 1 ? `-parte-${p + 1}` : '';
      files.push({ name: `${String(i + 1).padStart(2, '0')}-${g.key}${suffix}.csv`, content: toCsv(rows) });
    });
  });
  const now = new Date().toISOString();
  const summary = [
    'Administradoras de propiedad horizontal — Bogotá',
    'Fuente: RUES – Confecámaras, datos.gov.co (dataset c82u-588k), licencia CC BY-SA 4.0.',
    `Consulta: ${now}`,
    '',
    ...groups.map((g, i) => `${i + 1}. ${g.label}: ${g.rows.length} (sin repetidos; ${raw[i].rows.length} antes de quitar NIT de grupos anteriores)`),
    '',
    'Importar en este orden en /growth/importaciones (Organizaciones).',
  ].join('\r\n');

  await mkdir(outDir, { recursive: true });
  for (const f of files) await writeFile(join(outDir, f.name), f.content, 'utf8');
  await writeFile(join(outDir, 'resumen.txt'), '﻿' + summary + '\r\n', 'utf8');
  console.log(`\n${files.length} archivo(s) en ${outDir}`);
}

main().catch((e) => {
  console.error(`\nError: ${e.message}\nNo se escribió ningún archivo.`);
  process.exit(1);
});
