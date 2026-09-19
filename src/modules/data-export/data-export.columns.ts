import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { EntityMetadata } from 'typeorm';

import { HEADER_LABELS } from './data-export.headers';

/**
 * Columnas que nunca salen en un respaldo, aunque la entidad las tenga: una
 * descarga termina en un correo o en una memoria USB, y una credencial ahí es
 * una credencial filtrada.
 */
const SENSITIVE_COLUMN =
  /(password|token|secret|otp|salt|p256dh|endpoint|voterkey)/i;

export function headerFor(propertyName: string): string {
  return HEADER_LABELS[propertyName] ?? propertyName;
}

/**
 * Columnas de datos de la entidad: sin credenciales, sin la de borrado lógico
 * (siempre vacía, lo borrado no se exporta) y sin duplicados, que aparecen
 * cuando una entidad declara la relación y también su id.
 */
export function exportableColumns(metadata: EntityMetadata): ColumnMetadata[] {
  const seen = new Set<string>();
  return metadata.columns.filter((column) => {
    if (column.isVirtual) return false;
    if (column === metadata.deleteDateColumn) return false;
    if (SENSITIVE_COLUMN.test(column.propertyName)) return false;
    if (SENSITIVE_COLUMN.test(column.databaseName)) return false;
    if (seen.has(column.databaseName)) return false;
    seen.add(column.databaseName);
    return true;
  });
}

/** Colombia no tiene horario de verano: UTC-5 todo el año. */
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * Lo que va en la celda. Las fechas se corren a hora de Bogotá porque Excel no
 * tiene zona horaria: si se escribe la UTC, un pago de las 8 p. m. aparece al
 * día siguiente.
 */
export function cellValue(value: unknown): string | number | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return new Date(value.getTime() - BOGOTA_OFFSET_MS);
  }
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (Array.isArray(value)) {
    return value
      .map((item) =>
        typeof item === 'object' ? JSON.stringify(item) : String(item),
      )
      .join('; ');
  }
  return asText(value);
}

/** Tipos numéricos que el driver entrega como texto y conviene sumar. */
const DECIMAL_TYPES = new Set([
  'decimal',
  'numeric',
  'money',
  'real',
  'double precision',
  'float',
]);
const INTEGER_TYPES = new Set([
  'int',
  'integer',
  'smallint',
  'bigint',
  'int4',
  'int8',
]);

export function isNumericColumn(column: ColumnMetadata): boolean {
  const type = String(column.type).toLowerCase();
  return (
    DECIMAL_TYPES.has(type) || INTEGER_TYPES.has(type) || column.type === Number
  );
}

/** Columnas de dinero: se totalizan en el resumen. */
const MONEY_COLUMN =
  /(amount|total|value|cost|price|balance|debit|credit|fine|fee)$/i;

export function isMoneyColumn(column: ColumnMetadata): boolean {
  return (
    isNumericColumn(column) &&
    MONEY_COLUMN.test(column.propertyName) &&
    !/id$/i.test(column.propertyName)
  );
}

/**
 * Columnas por las que vale la pena contar en el resumen: los enums (estado,
 * tipo) y las de texto que se llaman así aunque no sean enum en la base.
 */
export function isCategoryColumn(column: ColumnMetadata): boolean {
  if (column.enum && column.enum.length > 0) return true;
  return [
    'status',
    'type',
    'kind',
    'category',
    'priority',
    'severity',
  ].includes(column.propertyName);
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/**
 * Texto de un id o de un valor simple. Los objetos van como JSON: su
 * conversión por defecto es `[object Object]`, que no le sirve a nadie.
 */
export function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value) ?? '';
}
