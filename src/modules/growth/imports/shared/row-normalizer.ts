import { GrowthIdentifierType } from '../../shared/growth.enums';
import { normalizeIdentifier } from '../../shared/identifier-normalizer';
import {
  GrowthBogotaLocality,
  GrowthBuildingKind,
  GrowthPhType,
} from '../../prospects/prospects.enums';
import {
  nitCheckDigit,
  normalizeBogotaAddress,
  normalizeRegistration,
  splitNit,
  stripAccents,
} from '../../prospects/shared/prospect-normalizers';
import { GENERIC_EMAIL_DOMAINS } from '../../prospects/shared/similarity';
import {
  GrowthImportField as F,
  GrowthImportTarget as T,
} from '../imports.enums';
import { IMPORT_FIELDS } from './field-catalog';
import { containsRedacted } from './redaction';

export interface ImportIssueValue {
  field?: string;
  code: string;
}

/** Claves exactas para cruzar duplicados (ya normalizadas). */
export interface ImportMatchKeys {
  nit?: string;
  registration?: string;
  email?: string;
  phone?: string;
  domain?: string;
  address?: string;
}

export interface NormalizedRow {
  /** Valores listos para el input del servicio de 1A. */
  values: Partial<Record<F, string | number | boolean>>;
  keys: ImportMatchKeys;
  errors: ImportIssueValue[];
}

/** Longitudes de los DTO de 1A: los servicios no pasan por el ValidationPipe. */
const LENGTH: Partial<Record<F, [number, number]>> = {
  [F.LEGAL_NAME]: [2, 200],
  [F.TRADE_NAME]: [2, 200],
  [F.NAME]: [2, 200],
  [F.FULL_NAME]: [2, 160],
  [F.ADDRESS]: [3, 300],
  [F.CITY]: [2, 60],
  [F.NEIGHBORHOOD]: [2, 120],
  [F.REAL_ESTATE_REGISTRATION]: [3, 40],
  [F.EMAIL]: [3, 320],
  [F.PHONE]: [3, 320],
};

const LOCALITIES = Object.values(GrowthBogotaLocality);

const LOCALITY_ALIASES: Record<string, GrowthBogotaLocality> = {
  MARTIRES: GrowthBogotaLocality.LOS_MARTIRES,
  CANDELARIA: GrowthBogotaLocality.LA_CANDELARIA,
  RAFAEL_URIBE: GrowthBogotaLocality.RAFAEL_URIBE_URIBE,
  SANTAFE: GrowthBogotaLocality.SANTA_FE,
};

const BUILDING_ALIASES: Record<string, GrowthBuildingKind> = {
  CASAS: GrowthBuildingKind.CONJUNTO_CASAS,
  CONJUNTO_DE_CASAS: GrowthBuildingKind.CONJUNTO_CASAS,
  APARTAMENTOS: GrowthBuildingKind.CONJUNTO_APARTAMENTOS,
  CONJUNTO_DE_APARTAMENTOS: GrowthBuildingKind.CONJUNTO_APARTAMENTOS,
};

const enumKey = (value: string) =>
  stripAccents(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

/** "Ciudad Bolívar", "ciudad bolivar" o "19" → CIUDAD_BOLIVAR. */
export function parseLocality(value: string): GrowthBogotaLocality | null {
  const key = enumKey(value);
  if (/^\d{1,2}$/.test(key)) return LOCALITIES[Number(key) - 1] ?? null;
  return (
    ((LOCALITIES as string[]).includes(key)
      ? (key as GrowthBogotaLocality)
      : LOCALITY_ALIASES[key]) ?? null
  );
}

function parseOption<E extends string>(
  value: string,
  options: E[],
  aliases: Record<string, E> = {},
): E | null {
  const key = enumKey(value);
  return (options as string[]).includes(key)
    ? (key as E)
    : (aliases[key] ?? null);
}

/** "sí", "x", "1" → true; "no", "0" → false. */
export function parseBoolean(value: string): boolean | null {
  const v = stripAccents(value).trim().toLowerCase();
  if (['si', 's', 'true', 'verdadero', '1', 'x', 'yes'].includes(v))
    return true;
  if (['no', 'n', 'false', 'falso', '0'].includes(v)) return false;
  return null;
}

/** Entero con separador de miles ("1.200" o "1,200"). Sin decimales. */
export function parseInteger(value: string): number | null {
  const v = value.trim().replace(/\s/g, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(v)) return Number(v.replace(/[.,]/g, ''));
  if (/^\d{1,9}$/.test(v)) return Number(v);
  return null;
}

export function normalizeCityName(value: string): string {
  const c = stripAccents(value).trim().toUpperCase();
  return ['BOGOTA', 'BOGOTA D.C.', 'BOGOTA DC', 'BOGOTA, D.C.'].includes(c)
    ? 'BOGOTA'
    : c;
}

/**
 * Normaliza y valida una fila según el mapeo. Los errores nunca copian el
 * valor (pueden ser datos personales): solo el campo y un código.
 */
export function normalizeRow(
  target: T,
  raw: string[],
  mapping: Array<{ column: number; field: F }>,
): NormalizedRow {
  const values: NormalizedRow['values'] = {};
  const keys: ImportMatchKeys = {};
  const errors: ImportIssueValue[] = [];
  const err = (field: F, code: string) => errors.push({ field, code });

  for (const { column, field } of mapping) {
    const value = (raw[column] ?? '').trim();
    if (!value) continue;
    // Correo o teléfono excluido: ya viene redactado; el aviso lo pone la validación.
    if ((field === F.EMAIL || field === F.PHONE) && containsRedacted(value)) {
      continue;
    }
    const len = LENGTH[field];
    if (len && value.length < len[0]) {
      err(field, 'TOO_SHORT');
      continue;
    }
    if (len && value.length > len[1]) {
      err(field, 'TOO_LONG');
      continue;
    }

    switch (field) {
      case F.NIT: {
        const parsed = splitNit(value);
        if (!parsed || value.length > 16) {
          err(field, 'INVALID_NIT');
        } else if (
          parsed.checkDigit &&
          parsed.checkDigit !== nitCheckDigit(parsed.nit)
        ) {
          err(field, 'NIT_CHECK_DIGIT');
        } else {
          values[field] = value;
          keys.nit = parsed.nit;
        }
        break;
      }
      case F.EMAIL: {
        const email = normalizeIdentifier(GrowthIdentifierType.EMAIL, value);
        if (!email) err(field, 'INVALID_EMAIL');
        else {
          values[field] = value;
          keys.email = email;
        }
        break;
      }
      case F.PHONE: {
        const phone = normalizeIdentifier(GrowthIdentifierType.PHONE, value);
        if (!phone) err(field, 'INVALID_PHONE');
        else {
          values[field] = value;
          keys.phone = phone;
        }
        break;
      }
      case F.WEBSITE: {
        const domain = normalizeIdentifier(GrowthIdentifierType.DOMAIN, value);
        if (!domain || value.length > 300) err(field, 'INVALID_WEBSITE');
        else {
          values[field] = value;
          if (!GENERIC_EMAIL_DOMAINS.has(domain)) keys.domain = domain;
        }
        break;
      }
      case F.LOCALITY: {
        const locality = parseLocality(value);
        if (!locality) err(field, 'INVALID_LOCALITY');
        else values[field] = locality;
        break;
      }
      case F.PH_TYPE: {
        const ph = parseOption(value, Object.values(GrowthPhType));
        if (!ph) err(field, 'INVALID_OPTION');
        else values[field] = ph;
        break;
      }
      case F.BUILDING_KIND: {
        const kind = parseOption(
          value,
          Object.values(GrowthBuildingKind),
          BUILDING_ALIASES,
        );
        if (!kind) err(field, 'INVALID_OPTION');
        else values[field] = kind;
        break;
      }
      case F.ESTIMATED_PROPERTIES:
      case F.ESTIMATED_UNITS: {
        const n = parseInteger(value);
        const min =
          target === T.PROPERTIES && field === F.ESTIMATED_UNITS ? 1 : 0;
        if (n === null || n < min) err(field, 'INVALID_NUMBER');
        else values[field] = n;
        break;
      }
      case F.IS_INDEPENDENT_ADMIN: {
        const b = parseBoolean(value);
        if (b === null) err(field, 'INVALID_BOOLEAN');
        else values[field] = b;
        break;
      }
      case F.REAL_ESTATE_REGISTRATION:
        values[field] = value;
        keys.registration = normalizeRegistration(value);
        break;
      case F.ADDRESS:
        values[field] = value;
        if (target !== T.PEOPLE) {
          const address = normalizeBogotaAddress(value);
          if (address) keys.address = address;
        }
        break;
      default:
        values[field] = value;
    }
  }

  for (const d of IMPORT_FIELDS[target]) {
    if (
      d.required &&
      values[d.field] === undefined &&
      !errors.some((e) => e.field === String(d.field))
    ) {
      err(d.field, 'REQUIRED');
    }
  }
  // Igual que el servicio de 1A: la localidad solo aplica a Bogotá.
  if (
    values[F.LOCALITY] &&
    values[F.CITY] &&
    normalizeCityName(String(values[F.CITY])) !== 'BOGOTA'
  ) {
    err(F.LOCALITY, 'LOCALITY_OUTSIDE_BOGOTA');
    delete values[F.LOCALITY];
  }
  return { values, keys, errors };
}
