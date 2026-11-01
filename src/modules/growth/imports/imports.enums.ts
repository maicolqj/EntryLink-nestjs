import { registerEnumType } from '@nestjs/graphql';

/** Qué se importa. En la base: varchar + CHECK (ver la migración de 1C). */
export enum GrowthImportTarget {
  ORGANIZATIONS = 'ORGANIZATIONS',
  PROPERTIES = 'PROPERTIES',
  PEOPLE = 'PEOPLE',
}

export enum GrowthImportStatus {
  UPLOADED = 'UPLOADED',
  MAPPED = 'MAPPED',
  VALIDATING = 'VALIDATING',
  VALIDATED = 'VALIDATED',
  COMMITTING = 'COMMITTING',
  COMMITTED = 'COMMITTED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

export const IMPORT_TERMINAL: GrowthImportStatus[] = [
  GrowthImportStatus.COMMITTED,
  GrowthImportStatus.FAILED,
  GrowthImportStatus.CANCELLED,
];

export enum GrowthImportFileKind {
  CSV = 'CSV',
  XLSX = 'XLSX',
}

export enum GrowthImportDecision {
  CREATE = 'CREATE',
  SKIP = 'SKIP',
  /** No crea ni cambia nada: deja evidencias en el registro existente. */
  LINK_EXISTING = 'LINK_EXISTING',
}

export enum GrowthImportRowResult {
  CREATED = 'CREATED',
  LINKED = 'LINKED',
  SKIPPED = 'SKIPPED',
  FAILED = 'FAILED',
}

/** Campos importables (plan §18). */
export enum GrowthImportField {
  // Empresas
  LEGAL_NAME = 'legalName',
  TRADE_NAME = 'tradeName',
  WEBSITE = 'website',
  ESTIMATED_PROPERTIES = 'estimatedProperties',
  // Copropiedades
  NAME = 'name',
  PH_TYPE = 'phType',
  BUILDING_KIND = 'buildingKind',
  NEIGHBORHOOD = 'neighborhood',
  REAL_ESTATE_REGISTRATION = 'realEstateRegistration',
  // Personas
  FULL_NAME = 'fullName',
  IS_INDEPENDENT_ADMIN = 'isIndependentAdmin',
  // Compartidos
  NIT = 'nit',
  ADDRESS = 'address',
  CITY = 'city',
  LOCALITY = 'locality',
  ESTIMATED_UNITS = 'estimatedUnits',
  EMAIL = 'email',
  PHONE = 'phone',
}

const enums: Array<[object, string, string]> = [
  [GrowthImportTarget, 'GrowthImportTarget', 'Qué se importa'],
  [
    GrowthImportStatus,
    'GrowthImportStatus',
    'Estado de un lote de importación',
  ],
  [
    GrowthImportFileKind,
    'GrowthImportFileKind',
    'Formato del archivo importado',
  ],
  [
    GrowthImportDecision,
    'GrowthImportDecision',
    'Qué hacer con una fila al confirmar',
  ],
  [GrowthImportRowResult, 'GrowthImportRowResult', 'Resultado de una fila'],
  [GrowthImportField, 'GrowthImportField', 'Campo de destino de una columna'],
];
for (const [e, name, description] of enums) {
  registerEnumType(e, { name, description });
}
