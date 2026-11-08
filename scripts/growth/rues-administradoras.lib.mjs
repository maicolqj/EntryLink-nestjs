/**
 * Administradoras de propiedad horizontal de Bogotá desde el RUES
 * (Confecámaras, datos.gov.co, CC BY-SA 4.0). Funciones puras: el CLI
 * (`rues-administradoras.mjs`) hace la red y escribe los archivos.
 *
 * Diseño: docs/superpowers/specs/2026-11-05-growth-rues-administradoras-design.md
 */

export const RUES_ENDPOINT = 'https://www.datos.gov.co/resource/c82u-588k.json';
export const PAGE_SIZE = 1000;
/** Tope de filas por lote del importador de Growth (IMPORT_MAX_ROWS). */
export const MAX_ROWS_PER_FILE = 5000;

/** Cámara de Bogotá, matrícula activa, persona jurídica (NIT). */
const BASE =
  "codigo_camara='04' AND codigo_estado_matricula='01' AND codigo_clase_identificacion='02'";

/** En orden de confianza: un NIT repetido se queda en el primero. */
export const GROUPS = [
  {
    key: 'ciiu-principal-renovadas',
    label: 'CIIU principal 8110',
    where: `${BASE} AND cod_ciiu_act_econ_pri='8110' AND ultimo_ano_renovado >= '2025'`,
  },
  {
    key: 'ciiu-principal-antiguas',
    label: 'CIIU principal 8110, renovación antigua',
    where: `${BASE} AND cod_ciiu_act_econ_pri='8110' AND (ultimo_ano_renovado < '2025' OR ultimo_ano_renovado IS NULL)`,
  },
  {
    key: 'ciiu-secundaria',
    label: 'CIIU secundaria 8110',
    where: `${BASE} AND cod_ciiu_act_econ_sec='8110' AND cod_ciiu_act_econ_pri != '8110'`,
  },
  {
    key: 'nombre-ph',
    label: 'Nombre con PROPIEDAD HORIZONTAL',
    where: `${BASE} AND upper(razon_social) like '%PROPIEDAD HORIZONTAL%' AND (cod_ciiu_act_econ_pri != '8110' OR cod_ciiu_act_econ_pri IS NULL) AND (cod_ciiu_act_econ_sec != '8110' OR cod_ciiu_act_econ_sec IS NULL)`,
  },
];

/** Solo lo que sale al archivo: nunca el representante legal. */
const SELECT = [
  'razon_social',
  'nit',
  // Hay filas activas con `nit` NULL: el número viene en numero_identificacion.
  'numero_identificacion',
  'digito_verificacion',
  'cod_ciiu_act_econ_pri',
  'cod_ciiu_act_econ_sec',
  'ultimo_ano_renovado',
].join(',');

export const HEADERS = ['Razón social', 'NIT', 'Ciudad', 'Observaciones'];

export function buildUrl(where, offset, limit = PAGE_SIZE) {
  const url = new URL(RUES_ENDPOINT);
  url.searchParams.set('$select', SELECT);
  url.searchParams.set('$where', where);
  // :id es único: con `nit` habría empates (filas sin NIT) y el offset podría saltar filas.
  url.searchParams.set('$order', ':id');
  url.searchParams.set('$limit', String(limit));
  url.searchParams.set('$offset', String(offset));
  return url.toString();
}

/** Cuántas filas tiene el grupo, para comprobar que la descarga quedó completa. */
export function buildCountUrl(where) {
  const url = new URL(RUES_ENDPOINT);
  url.searchParams.set('$select', 'count(*) AS n');
  url.searchParams.set('$where', where);
  return url.toString();
}

export function assertComplete(label, expected, got) {
  if (expected === 0) throw new Error(`«${label}» devolvió 0 filas: revisa el filtro o la API`);
  if (got !== expected) {
    throw new Error(`Descarga incompleta de «${label}»: la API dice ${expected} y llegaron ${got}`);
  }
}

export function assertRecords(page) {
  page.forEach((rec, i) => {
    if (!rec || typeof rec !== 'object' || typeof rec.razon_social !== 'string') {
      throw new Error(`La API devolvió un registro sin razón social (posición ${i})`);
    }
  });
}

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

export function toRow(rec, groupLabel) {
  const nit = clean(rec.nit) || clean(rec.numero_identificacion);
  const dv = clean(rec.digito_verificacion);
  const pri = clean(rec.cod_ciiu_act_econ_pri) || '—';
  const sec = clean(rec.cod_ciiu_act_econ_sec) || '—';
  const year = clean(rec.ultimo_ano_renovado) || '—';
  return {
    'Razón social': clean(rec.razon_social),
    NIT: dv ? `${nit}-${dv}` : nit,
    Ciudad: 'Bogotá',
    Observaciones: `RUES · CIIU ${pri}/${sec} · ${groupLabel} · renovado ${year}`,
  };
}

/** Por NIT base (sin dígito). Las filas sin identificador no se colapsan entre sí. */
export function dedupeAcrossGroups(groups) {
  const seen = new Set();
  return groups.map((g) => ({
    ...g,
    rows: g.rows.filter((row) => {
      const base = String(row.NIT ?? '').split('-')[0];
      if (!base) return true;
      if (seen.has(base)) return false;
      seen.add(base);
      return true;
    }),
  }));
}

const cell = (v) => {
  const s = String(v ?? '');
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** UTF-8 con BOM, separador `;` y CRLF: Excel en español lo abre bien. */
export function toCsv(rows) {
  const lines = [HEADERS.join(';'), ...rows.map((r) => HEADERS.map((h) => cell(r[h])).join(';'))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}
