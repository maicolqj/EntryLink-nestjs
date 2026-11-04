import { ValidPermissions } from '../../../permissions/enums/valid-permissions';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { actorHas } from '../../shared/growth-actor';
import { GrowthIdentifierType } from '../../shared/growth.enums';
import { normalizeIdentifier } from '../../shared/identifier-normalizer';
import {
  GrowthImportField as F,
  GrowthImportTarget as T,
  GrowthImportTemplateScope as Scope,
} from '../imports.enums';
import { IMPORT_FIELDS, normalizeHeader } from './field-catalog';

/*
 * Reglas de las plantillas de mapeo, sin base de datos (las prueba
 * templates.spec.ts). Una plantilla guarda solo encabezados y el campo de
 * cada uno: nunca valores del archivo.
 */

export const TEMPLATE_NAME_MIN = 2;
export const TEMPLATE_NAME_MAX = 80;
export const TEMPLATE_HEADER_MAX = 200;
export const TEMPLATE_MAPPING_MAX = 100;

/** Espacios colapsados y recortados: «Directorio  IT » → «Directorio IT». */
export function normalizeTemplateName(name: string): string {
  return (name ?? '').replace(/\s+/g, ' ').trim();
}

export function templateNameProblem(name: string): string | null {
  const n = normalizeTemplateName(name);
  if (n.length < TEMPLATE_NAME_MIN || n.length > TEMPLATE_NAME_MAX) {
    return `El nombre debe tener entre ${TEMPLATE_NAME_MIN} y ${TEMPLATE_NAME_MAX} caracteres`;
  }
  return null;
}

/**
 * Un encabezado que es un correo o un teléfono es un dato, no un rótulo de
 * columna (pasa con archivos sin fila de encabezados). No se guarda.
 */
export function looksLikeContactValue(header: string): boolean {
  const v = (header ?? '').trim();
  if (!v) return false;
  return (
    !!normalizeIdentifier(GrowthIdentifierType.EMAIL, v) ||
    !!normalizeIdentifier(GrowthIdentifierType.PHONE, v)
  );
}

/** Problemas de un mapeo por encabezado para un destino; vacío si sirve. */
export function templateMappingProblems(
  target: T,
  mapping: Array<{ header: string; field: F }>,
): string[] {
  const problems: string[] = [];
  if (!Array.isArray(mapping) || mapping.length === 0) {
    return ['La plantilla necesita al menos una columna'];
  }
  if (mapping.length > TEMPLATE_MAPPING_MAX) {
    problems.push(
      `Una plantilla admite hasta ${TEMPLATE_MAPPING_MAX} columnas`,
    );
  }
  const allowed = new Set(IMPORT_FIELDS[target].map((d) => d.field));
  const headers = new Set<string>();
  const fields = new Set<F>();
  for (const m of mapping) {
    const header = (m.header ?? '').trim();
    if (!header || header.length > TEMPLATE_HEADER_MAX) {
      problems.push(
        `Cada encabezado debe tener entre 1 y ${TEMPLATE_HEADER_MAX} caracteres`,
      );
      continue;
    }
    if (looksLikeContactValue(header)) {
      problems.push(
        'Un encabezado no puede ser un correo ni un teléfono: la plantilla no guarda datos',
      );
    }
    const key = normalizeHeader(header);
    if (headers.has(key)) problems.push(`Encabezado repetido: ${header}`);
    headers.add(key);
    if (!allowed.has(m.field)) {
      problems.push(`El campo ${m.field} no aplica a ${target}`);
    } else if (fields.has(m.field)) {
      problems.push(`El campo ${m.field} está asignado dos veces`);
    }
    fields.add(m.field);
  }
  return [...new Set(problems)];
}

export interface TemplateAccessView {
  scope: Scope;
  ownerUserId: string;
  archivedAt: Date | null;
}

/** Una personal solo la ve su dueño; una del equipo, todo quien importa. */
export function canReadTemplate(
  t: TemplateAccessView,
  actor: JwtAccessPayload,
): boolean {
  return t.scope === Scope.TEAM || t.ownerUserId === actor.sub;
}

/**
 * Editar, renombrar o archivar: la personal, su dueño; la del equipo, quien
 * tenga MANAGE_GROWTH_IMPORT_TEMPLATES. Una archivada no se edita.
 */
export function canEditTemplate(
  t: TemplateAccessView,
  actor: JwtAccessPayload,
): boolean {
  if (t.archivedAt) return false;
  if (t.scope === Scope.PERSONAL) return t.ownerUserId === actor.sub;
  return actorHas(actor, ValidPermissions.MANAGE_GROWTH_IMPORT_TEMPLATES);
}

/** Crear del equipo o compartir una personal exige el permiso de gestión. */
export function canManageTeamTemplates(actor: JwtAccessPayload): boolean {
  return actorHas(actor, ValidPermissions.MANAGE_GROWTH_IMPORT_TEMPLATES);
}
