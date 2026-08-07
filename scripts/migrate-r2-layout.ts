/**
 * Migración de la estructura de carpetas de Cloudflare R2.
 *
 * ANTES (dos raíces distintas, R2 distingue mayúsculas):
 *   entrylink/{module}/{...}            → generado por buildFolder()
 *   entryLink/{complexSlug}/packages/…  → ruta hardcodeada en PackagesController
 *
 * DESPUÉS (una sola raíz, complejo primero):
 *   EntryLink/{complexSlug}/{module}/{...}
 *   EntryLink/_platform/{module}/{...}   para archivos sin complejo dueño
 *
 * La migración se guía por la BASE DE DATOS, no por el listado del bucket: la
 * ruta vieja no dice a qué complejo pertenece una foto de visitante o vehículo,
 * pero la fila sí. Cada archivo referenciado se recoloca donde la aplicación lo
 * escribiría hoy y se actualiza la URL (y el publicId cuando la entidad lo
 * guarda). Los objetos que no estén referenciados en BD quedan intactos: son
 * huérfanos y borrarlos es una decisión aparte.
 *
 * Orden por archivo: copiar → actualizar BD → (opcional) borrar el original.
 * Si algo falla a mitad, lo peor que queda es una copia de más, nunca una URL
 * apuntando a un objeto inexistente.
 *
 * USO
 *   yarn r2:migrate                          # simulación, no escribe nada
 *   yarn r2:migrate --apply                  # copia objetos y actualiza la BD
 *   yarn r2:migrate --apply --delete-source  # además borra los originales
 *
 *   --only=packages,notes   limita a ciertos grupos (ver TARGET_NAMES)
 *   --limit=50              procesa como máximo N filas por grupo (pruebas)
 *   --report=ruta.json      archivo de reporte (default: r2-migration-report.json)
 *
 * RECOMENDADO: primero `yarn r2:migrate`, revisar el reporte, luego `--apply`
 * SIN `--delete-source`. Cuando confirmes que la app sirve bien las imágenes
 * nuevas, corre una segunda pasada con `--delete-source` para limpiar.
 */

import 'reflect-metadata';
import * as dotenv from 'dotenv';

dotenv.config();

import { writeFileSync } from 'fs';
import {
  S3Client,
  CopyObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { IsNull, Not, Repository } from 'typeorm';

import dataSource from '../src/core/database/data-source';
import {
  buildFolderPath,
  resolveAppRoot,
  PLATFORM_SCOPE,
} from '../src/core/infrastructure/r2/r2-paths';

import { Visitor }           from '../src/modules/visitors/entities/visitor.entity';
import { Vehicle }           from '../src/modules/vehicles/entities/vehicle.entity';
import { User }              from '../src/modules/users/entities/user.entity';
import { Note }              from '../src/modules/notes/entities/note.entity';
import { Package }           from '../src/modules/packages/entities/package.entity';
import { ResidentialComplex } from '../src/modules/residential-complex/entities/residential-complex.entity';
import { LegalDocument }     from '../src/modules/legal/entities/legal-document.entity';

// ============================================================================
// CLI
// ============================================================================

const args        = process.argv.slice(2);
const APPLY       = args.includes('--apply');
const DELETE_SRC  = args.includes('--delete-source');
const ONLY        = readArg('--only')?.split(',').map(s => s.trim()).filter(Boolean);
const LIMIT       = Number(readArg('--limit')) || undefined;
const REPORT_PATH = readArg('--report') ?? 'r2-migration-report.json';

function readArg(name: string): string | undefined {
  const hit = args.find(a => a.startsWith(`${name}=`));
  return hit?.slice(name.length + 1);
}

// ============================================================================
// TIPOS
// ============================================================================

/** Un archivo a recolocar dentro del bucket. */
interface ObjectMove {
  oldKey: string;
  newKey: string;
}

/**
 * Todo lo que hay que hacer por fila: mover sus archivos y dejar las columnas
 * apuntando a las claves nuevas. Se agrupa por fila porque `notes.image_urls`
 * es un array: varios objetos, un solo UPDATE.
 */
interface RowPlan {
  target:  string;
  rowId:   string;
  label:   string;
  objects: ObjectMove[];
  updates: Record<string, unknown>;
}

/** Fila que no se pudo planificar (URL ajena al bucket, complejo inexistente…). */
interface SkippedRow {
  target: string;
  rowId:  string;
  reason: string;
  detail: string;
}

interface TargetResult {
  name:    string;
  plans:   RowPlan[];
  skipped: SkippedRow[];
}

// ============================================================================
// CONFIGURACIÓN DE R2
// ============================================================================

const ACCOUNT_ID = requireEnv('R2_ACCOUNT_ID');
const BUCKET     = requireEnv('R2_BUCKET_NAME');
const APP_ROOT   = resolveAppRoot(process.env.APPNAME);
const PUBLIC_URL = normalizePublicUrl(process.env.R2_PUBLIC_URL ?? '');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`✖ Falta la variable de entorno ${name}`);
    process.exit(1);
  }
  return value;
}

function normalizePublicUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '');
  if (!trimmed) return '';
  return trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
}

const s3 = new S3Client({
  region:      'auto',
  endpoint:    `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     requireEnv('R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
  },
  forcePathStyle: true,
});

// ============================================================================
// HELPERS DE CLAVES Y URLS
// ============================================================================

/**
 * Extrae la clave del objeto a partir de la URL pública guardada en BD.
 * Devuelve null si la URL no parece apuntar a nuestro bucket (por ejemplo una
 * imagen externa cargada a mano): esas filas se reportan y no se tocan.
 */
function keyFromUrl(url: string): string | null {
  const clean = url.trim();
  if (!clean) return null;

  if (PUBLIC_URL && clean.startsWith(`${PUBLIC_URL}/`)) {
    return decodeURIComponent(clean.slice(PUBLIC_URL.length + 1));
  }

  // Sin R2_PUBLIC_URL configurado, o con un dominio público distinto al actual
  // (migraciones de dominio): nos quedamos con el path de la URL.
  try {
    const parsed = new URL(clean);
    const key    = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    return key || null;
  } catch {
    return null;
  }
}

function urlFromKey(key: string): string {
  return `${PUBLIC_URL}/${key}`;
}

/** El nombre de archivo (UUID + extensión) se conserva tal cual al recolocar. */
function fileNameOf(key: string): string {
  return key.split('/').pop() ?? key;
}

/**
 * Planifica el movimiento de una URL. Devuelve null cuando el archivo ya está
 * en su sitio, de modo que el script es idempotente y se puede repetir.
 */
function planMove(url: string | null | undefined, newFolder: string): ObjectMove | null | 'unmapped' {
  if (!url) return null;

  const oldKey = keyFromUrl(url);
  if (!oldKey) return 'unmapped';

  const newKey = `${newFolder}/${fileNameOf(oldKey)}`;
  return oldKey === newKey ? null : { oldKey, newKey };
}

// ============================================================================
// RECOLECCIÓN: qué mover, por grupo
// ============================================================================

const TARGET_NAMES = [
  'visitors',
  'vehicles',
  'user-profile-pictures',
  'user-company-cards',
  'notes',
  'packages',
  'complex-documents',
  'complex-signed-dpa',
  'legal-documents',
] as const;

type TargetName = typeof TARGET_NAMES[number];

/** complexId → slug. La tabla de complejos es pequeña: se carga entera. */
let SLUG_BY_COMPLEX_ID = new Map<string, string>();

async function loadComplexSlugs(): Promise<void> {
  const complexes = await dataSource.getRepository(ResidentialComplex).find({
    select:      ['id', 'slug'],
    withDeleted: true,
  });
  SLUG_BY_COMPLEX_ID = new Map(complexes.map(c => [c.id, c.slug]));
  console.log(`  Complejos cargados: ${SLUG_BY_COMPLEX_ID.size}`);
}

/**
 * Slug del complejo dueño. Si el complejo ya no existe devolvemos null y el
 * archivo termina en `_platform`: preferible a dejarlo en la raíz vieja.
 */
function slugOf(complexId: string | null | undefined): string | null {
  if (!complexId) return null;
  return SLUG_BY_COMPLEX_ID.get(complexId) ?? null;
}

/**
 * Caso general: una fila, una columna con URL, y opcionalmente la columna donde
 * la entidad guarda la clave de R2 (publicId), que debe quedar sincronizada.
 */
async function collectSimple<T extends { id: string }>(
  target: TargetName,
  repo: Repository<T>,
  opts: {
    urlColumn:      keyof T & string;
    publicIdColumn?: keyof T & string;
    select:         (keyof T & string)[];
    folderOf:       (row: T) => string;
    labelOf:        (row: T) => string;
  },
): Promise<TargetResult> {
  const rows = await repo.find({
    select:      Array.from(new Set([...opts.select, 'id', opts.urlColumn])) as any,
    where:       { [opts.urlColumn]: Not(IsNull()) } as any,
    withDeleted: true,
    take:        LIMIT,
  });

  const plans:   RowPlan[]   = [];
  const skipped: SkippedRow[] = [];

  for (const row of rows) {
    const url  = row[opts.urlColumn] as unknown as string;
    const move = planMove(url, opts.folderOf(row));

    if (move === 'unmapped') {
      skipped.push({ target, rowId: row.id, reason: 'url-externa', detail: url });
      continue;
    }
    if (!move) continue; // ya está en la ruta nueva

    const updates: Record<string, unknown> = { [opts.urlColumn]: urlFromKey(move.newKey) };
    if (opts.publicIdColumn) updates[opts.publicIdColumn] = move.newKey;

    plans.push({
      target,
      rowId:   row.id,
      label:   opts.labelOf(row),
      objects: [move],
      updates,
    });
  }

  return { name: target, plans, skipped };
}

/** `notes.image_urls` es un array: varios objetos y un único UPDATE por fila. */
async function collectNotes(): Promise<TargetResult> {
  const repo = dataSource.getRepository(Note);
  const rows = await repo.find({
    select:      ['id', 'title', 'complexId', 'imageUrls'] as any,
    withDeleted: true,
    take:        LIMIT,
  });

  const plans:   RowPlan[]   = [];
  const skipped: SkippedRow[] = [];

  for (const note of rows) {
    const urls = note.imageUrls ?? [];
    if (!urls.length) continue;

    const folder  = buildFolderPath(APP_ROOT, slugOf(note.complexId), 'notes');
    const objects: ObjectMove[] = [];
    const newUrls: string[]     = [];
    let   changed = false;

    for (const url of urls) {
      const move = planMove(url, folder);

      if (move === 'unmapped') {
        skipped.push({ target: 'notes', rowId: note.id, reason: 'url-externa', detail: url });
        newUrls.push(url);            // se conserva intacta
        continue;
      }
      if (!move) {
        newUrls.push(url);            // ya está en la ruta nueva
        continue;
      }

      objects.push(move);
      newUrls.push(urlFromKey(move.newKey));
      changed = true;
    }

    if (!changed) continue;

    plans.push({
      target:  'notes',
      rowId:   note.id,
      label:   note.title ?? '(sin título)',
      objects,
      updates: { imageUrls: newUrls },
    });
  }

  return { name: 'notes', plans, skipped };
}

/**
 * El complejo tiene dos documentos en la misma carpeta (RUT y documento del
 * representante legal), así que la fila puede mover dos objetos a la vez.
 */
async function collectComplexDocuments(): Promise<TargetResult> {
  const repo = dataSource.getRepository(ResidentialComplex);
  const rows = await repo.find({
    select:      ['id', 'name', 'slug', 'rutFileUrl', 'legalRepDocumentUrl'] as any,
    withDeleted: true,
    take:        LIMIT,
  });

  const plans:   RowPlan[]   = [];
  const skipped: SkippedRow[] = [];

  for (const complex of rows) {
    const folder  = buildFolderPath(APP_ROOT, complex.slug, 'documents');
    const objects: ObjectMove[] = [];
    const updates: Record<string, unknown> = {};

    for (const column of ['rutFileUrl', 'legalRepDocumentUrl'] as const) {
      const url  = complex[column];
      const move = planMove(url, folder);

      if (move === 'unmapped') {
        skipped.push({
          target: 'complex-documents',
          rowId:  complex.id,
          reason: `url-externa (${column})`,
          detail: url as string,
        });
        continue;
      }
      if (!move) continue;

      objects.push(move);
      updates[column] = urlFromKey(move.newKey);
    }

    if (!objects.length) continue;

    plans.push({
      target: 'complex-documents',
      rowId:  complex.id,
      label:  complex.name,
      objects,
      updates,
    });
  }

  return { name: 'complex-documents', plans, skipped };
}

async function collectAll(): Promise<TargetResult[]> {
  const wanted = (name: TargetName) => !ONLY || ONLY.includes(name);
  const results: TargetResult[] = [];

  if (wanted('visitors')) {
    results.push(await collectSimple('visitors', dataSource.getRepository(Visitor), {
      urlColumn: 'photoUrl',
      select:    ['id', 'fullName', 'complexId'],
      folderOf:  v => buildFolderPath(APP_ROOT, slugOf(v.complexId), 'visitors', 'photos'),
      labelOf:   v => v.fullName ?? v.id,
    }));
  }

  if (wanted('vehicles')) {
    results.push(await collectSimple('vehicles', dataSource.getRepository(Vehicle), {
      urlColumn: 'photoUrl',
      select:    ['id', 'plate', 'complexId'],
      folderOf:  v => buildFolderPath(APP_ROOT, slugOf(v.complexId), 'vehicles', 'photos'),
      labelOf:   v => v.plate ?? v.id,
    }));
  }

  if (wanted('user-profile-pictures')) {
    results.push(await collectSimple('user-profile-pictures', dataSource.getRepository(User), {
      urlColumn: 'profilePicture',
      select:    ['id', 'email', 'complexId'],
      // Sin complejo (SUPER_ADMIN, COMPLIANCE) → carpeta de plataforma
      folderOf:  u => buildFolderPath(APP_ROOT, slugOf(u.complexId), 'users', 'profile-pictures'),
      labelOf:   u => u.email ?? u.id,
    }));
  }

  if (wanted('user-company-cards')) {
    results.push(await collectSimple('user-company-cards', dataSource.getRepository(User), {
      urlColumn: 'companyCardUrl',
      select:    ['id', 'email'],
      folderOf:  () => buildFolderPath(APP_ROOT, PLATFORM_SCOPE, 'auth', 'company-cards'),
      labelOf:   u => u.email ?? u.id,
    }));
  }

  if (wanted('notes'))     results.push(await collectNotes());

  if (wanted('packages')) {
    results.push(await collectSimple('packages', dataSource.getRepository(Package), {
      urlColumn: 'photoUrl',
      select:    ['id', 'senderName', 'complexId'],
      folderOf:  p => buildFolderPath(APP_ROOT, slugOf(p.complexId), 'packages', p.id),
      labelOf:   p => p.senderName ?? p.id,
    }));
  }

  if (wanted('complex-documents')) results.push(await collectComplexDocuments());

  if (wanted('complex-signed-dpa')) {
    results.push(await collectSimple('complex-signed-dpa', dataSource.getRepository(ResidentialComplex), {
      urlColumn:      'signedDpaUrl',
      publicIdColumn: 'signedDpaPublicId',
      select:         ['id', 'name', 'slug'],
      folderOf:       c => buildFolderPath(APP_ROOT, c.slug, 'documents', 'signed-dpa'),
      labelOf:        c => c.name,
    }));
  }

  if (wanted('legal-documents')) {
    results.push(await collectSimple('legal-documents', dataSource.getRepository(LegalDocument), {
      urlColumn:      'downloadFileUrl',
      publicIdColumn: 'downloadFilePublicId',
      select:         ['id', 'slug'],
      folderOf:       d => buildFolderPath(APP_ROOT, PLATFORM_SCOPE, 'legal', d.slug),
      labelOf:        d => d.slug,
    }));
  }

  return results;
}

// ============================================================================
// EJECUCIÓN
// ============================================================================

const REPO_BY_TARGET: Record<TargetName, () => Repository<any>> = {
  'visitors':              () => dataSource.getRepository(Visitor),
  'vehicles':              () => dataSource.getRepository(Vehicle),
  'user-profile-pictures': () => dataSource.getRepository(User),
  'user-company-cards':    () => dataSource.getRepository(User),
  'notes':                 () => dataSource.getRepository(Note),
  'packages':              () => dataSource.getRepository(Package),
  'complex-documents':     () => dataSource.getRepository(ResidentialComplex),
  'complex-signed-dpa':    () => dataSource.getRepository(ResidentialComplex),
  'legal-documents':       () => dataSource.getRepository(LegalDocument),
};

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err: any) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === 'NotFound') return false;
    throw err;
  }
}

async function copyObject(move: ObjectMove): Promise<void> {
  await s3.send(new CopyObjectCommand({
    Bucket:     BUCKET,
    Key:        move.newKey,
    CopySource: encodeURI(`${BUCKET}/${move.oldKey}`),
  }));
}

interface RowOutcome {
  plan:    RowPlan;
  status:  'migrado' | 'origen-ausente' | 'error';
  detail?: string;
}

/**
 * Copiar → actualizar BD → borrar original. Si falta algún objeto de origen se
 * aborta la fila entera sin tocar la BD: dejar media fila apuntando a claves
 * nuevas y media a viejas es peor que no migrarla.
 */
async function applyPlan(plan: RowPlan): Promise<RowOutcome> {
  try {
    for (const move of plan.objects) {
      if (await objectExists(move.newKey)) continue;   // reintento de una corrida previa

      if (!await objectExists(move.oldKey)) {
        return { plan, status: 'origen-ausente', detail: move.oldKey };
      }
      await copyObject(move);
    }

    await REPO_BY_TARGET[plan.target as TargetName]().update(plan.rowId, plan.updates as any);

    if (DELETE_SRC) {
      for (const move of plan.objects) {
        // Un fallo aquí solo deja un huérfano; la fila ya apunta a la clave nueva.
        await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: move.oldKey }))
          .catch(err => console.warn(`  ⚠ No se pudo borrar ${move.oldKey}: ${err?.message}`));
      }
    }

    return { plan, status: 'migrado' };
  } catch (err: any) {
    return { plan, status: 'error', detail: err?.message ?? String(err) };
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Migración de estructura de carpetas en Cloudflare R2');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Bucket        : ${BUCKET}`);
  console.log(`  Carpeta raíz  : ${APP_ROOT}`);
  console.log(`  URL pública   : ${PUBLIC_URL || '(sin configurar)'}`);
  console.log(`  Modo          : ${APPLY ? 'APLICAR CAMBIOS' : 'SIMULACIÓN (dry-run)'}`);
  console.log(`  Borrar origen : ${DELETE_SRC ? 'SÍ' : 'no (se conservan los originales)'}`);
  if (ONLY)  console.log(`  Grupos        : ${ONLY.join(', ')}`);
  if (LIMIT) console.log(`  Límite        : ${LIMIT} filas por grupo`);
  console.log('');

  if (!PUBLIC_URL) {
    console.error('✖ R2_PUBLIC_URL no está configurada: sin ella no se pueden reescribir las URLs.');
    process.exit(1);
  }

  if (APP_ROOT !== 'EntryLink') {
    console.warn(`⚠ La carpeta raíz resuelta es "${APP_ROOT}", no "EntryLink".`);
    console.warn('  Revisa APPNAME antes de continuar: migrarías a una raíz distinta');
    console.warn('  de la que usa la aplicación en este entorno.');
    console.warn('');
  }

  await dataSource.initialize();
  console.log('  Conectado a la base de datos');
  await loadComplexSlugs();
  console.log('');

  const results = await collectAll();

  // ── Resumen del plan ──────────────────────────────────────────────
  let totalRows = 0;
  let totalObjs = 0;

  for (const result of results) {
    const objs = result.plans.reduce((n, p) => n + p.objects.length, 0);
    totalRows += result.plans.length;
    totalObjs += objs;

    console.log(`▸ ${result.name}`);
    console.log(`    filas a migrar : ${result.plans.length}   archivos: ${objs}`);
    if (result.skipped.length) {
      console.log(`    omitidas       : ${result.skipped.length} (ver reporte)`);
    }

    // Muestra las primeras rutas para poder verificar el mapeo a simple vista
    for (const plan of result.plans.slice(0, 3)) {
      for (const move of plan.objects.slice(0, 2)) {
        console.log(`      ${move.oldKey}`);
        console.log(`        → ${move.newKey}`);
      }
    }
    console.log('');
  }

  console.log('───────────────────────────────────────────────────────────');
  console.log(`  TOTAL: ${totalRows} filas · ${totalObjs} archivos`);
  console.log('───────────────────────────────────────────────────────────');
  console.log('');

  const outcomes: RowOutcome[] = [];

  if (APPLY && totalRows > 0) {
    console.log('  Aplicando cambios…');
    let done = 0;

    for (const result of results) {
      for (const plan of result.plans) {
        const outcome = await applyPlan(plan);
        outcomes.push(outcome);
        done += 1;

        if (outcome.status !== 'migrado') {
          console.warn(`  ⚠ [${plan.target}] ${plan.rowId} — ${outcome.status}: ${outcome.detail}`);
        }
        if (done % 25 === 0) console.log(`    ${done}/${totalRows}…`);
      }
    }

    const ok      = outcomes.filter(o => o.status === 'migrado').length;
    const missing = outcomes.filter(o => o.status === 'origen-ausente').length;
    const failed  = outcomes.filter(o => o.status === 'error').length;

    console.log('');
    console.log(`  Migradas: ${ok} · Sin archivo de origen: ${missing} · Con error: ${failed}`);
    if (!DELETE_SRC) {
      console.log('  Los objetos originales siguen en el bucket. Cuando verifiques que');
      console.log('  la app sirve bien las imágenes, repite con --delete-source.');
    }
  } else if (APPLY) {
    console.log('  No hay nada que migrar.');
  } else {
    console.log('  Simulación: no se copió, actualizó ni borró nada.');
    console.log('  Para ejecutar de verdad: yarn r2:migrate --apply');
  }

  // ── Reporte ───────────────────────────────────────────────────────
  const report = {
    generatedAt:  new Date().toISOString(),
    bucket:       BUCKET,
    appRoot:      APP_ROOT,
    applied:      APPLY,
    deletedSource: APPLY && DELETE_SRC,
    totals:       { rows: totalRows, objects: totalObjs },
    targets: results.map(r => ({
      name:    r.name,
      plans:   r.plans,
      skipped: r.skipped,
    })),
    outcomes: outcomes.map(o => ({
      target: o.plan.target,
      rowId:  o.plan.rowId,
      status: o.status,
      detail: o.detail,
      moves:  o.plan.objects,
    })),
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log('');
  console.log(`  Reporte escrito en ${REPORT_PATH}`);
  console.log('');

  await dataSource.destroy();
}

main().catch(async err => {
  console.error('');
  console.error('✖ La migración falló:', err?.message ?? err);
  console.error(err);
  if (dataSource.isInitialized) await dataSource.destroy();
  process.exit(1);
});
