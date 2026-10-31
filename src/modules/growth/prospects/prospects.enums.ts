import { registerEnumType } from '@nestjs/graphql';

/**
 * Enums de EntryLink Prospect. En la base son varchar + CHECK
 * (migración CreateGrowthProspects); cambiar un valor exige migración.
 */

export enum GrowthValidationStatus {
  NEW = 'NEW',
  PENDING_REVIEW = 'PENDING_REVIEW',
  IN_VALIDATION = 'IN_VALIDATION',
  VALIDATED = 'VALIDATED',
  REJECTED = 'REJECTED',
  DUPLICATE = 'DUPLICATE',
  INCOMPLETE = 'INCOMPLETE',
}

/** Decisiones posibles al cerrar una validación tomada. */
export enum GrowthValidationDecision {
  VALIDATED = 'VALIDATED',
  REJECTED = 'REJECTED',
  INCOMPLETE = 'INCOMPLETE',
  DUPLICATE = 'DUPLICATE',
}

export enum GrowthProspectKind {
  ORGANIZATION = 'ORGANIZATION',
  PERSON = 'PERSON',
  PROPERTY = 'PROPERTY',
}

export enum GrowthBogotaLocality {
  USAQUEN = 'USAQUEN',
  CHAPINERO = 'CHAPINERO',
  SANTA_FE = 'SANTA_FE',
  SAN_CRISTOBAL = 'SAN_CRISTOBAL',
  USME = 'USME',
  TUNJUELITO = 'TUNJUELITO',
  BOSA = 'BOSA',
  KENNEDY = 'KENNEDY',
  FONTIBON = 'FONTIBON',
  ENGATIVA = 'ENGATIVA',
  SUBA = 'SUBA',
  BARRIOS_UNIDOS = 'BARRIOS_UNIDOS',
  TEUSAQUILLO = 'TEUSAQUILLO',
  LOS_MARTIRES = 'LOS_MARTIRES',
  ANTONIO_NARINO = 'ANTONIO_NARINO',
  PUENTE_ARANDA = 'PUENTE_ARANDA',
  LA_CANDELARIA = 'LA_CANDELARIA',
  RAFAEL_URIBE_URIBE = 'RAFAEL_URIBE_URIBE',
  CIUDAD_BOLIVAR = 'CIUDAD_BOLIVAR',
  SUMAPAZ = 'SUMAPAZ',
}

export enum GrowthInterestSignal {
  NONE = 'NONE',
  EXPRESSED = 'EXPRESSED',
  DEMO_REQUESTED = 'DEMO_REQUESTED',
}

export enum GrowthChannelKind {
  PHONE = 'PHONE',
  EMAIL = 'EMAIL',
  WEBSITE = 'WEBSITE',
  SOCIAL = 'SOCIAL',
}

/** Canal de una persona: profesional (publicado como tal) o directo. */
export enum GrowthChannelClass {
  PROFESSIONAL = 'PROFESSIONAL',
  DIRECT = 'DIRECT',
}

export enum GrowthLegalBasis {
  PENDING_LEGAL_REVIEW = 'PENDING_LEGAL_REVIEW',
  PUBLIC_DATA = 'PUBLIC_DATA',
  PRIOR_AUTHORIZATION = 'PRIOR_AUTHORIZATION',
  CONTRACT = 'CONTRACT',
  LEGAL_OBLIGATION = 'LEGAL_OBLIGATION',
}

export enum GrowthContactStatus {
  NOT_AUTHORIZED = 'NOT_AUTHORIZED',
  AUTHORIZED = 'AUTHORIZED',
  REVOKED = 'REVOKED',
}

export enum GrowthPhType {
  RESIDENCIAL = 'RESIDENCIAL',
  MIXTA = 'MIXTA',
  COMERCIAL = 'COMERCIAL',
}

export enum GrowthBuildingKind {
  CONJUNTO_CASAS = 'CONJUNTO_CASAS',
  CONJUNTO_APARTAMENTOS = 'CONJUNTO_APARTAMENTOS',
  EDIFICIO = 'EDIFICIO',
  MIXTO = 'MIXTO',
  OTRO = 'OTRO',
}

export enum GrowthInfoStatus {
  PARTIAL = 'PARTIAL',
  COMPLETE = 'COMPLETE',
  OUTDATED = 'OUTDATED',
}

export enum GrowthRelationStatus {
  CURRENT = 'CURRENT',
  PAST = 'PAST',
  UNCONFIRMED = 'UNCONFIRMED',
}

export enum GrowthManagerType {
  ORGANIZATION = 'ORGANIZATION',
  PERSON = 'PERSON',
  SELF_MANAGED = 'SELF_MANAGED',
}

export enum GrowthEvidenceReliability {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export enum GrowthEvidenceStatus {
  UNVERIFIED = 'UNVERIFIED',
  VERIFIED = 'VERIFIED',
  DISPUTED = 'DISPUTED',
  OBSOLETE = 'OBSOLETE',
}

const enums: Array<[object, string, string]> = [
  [
    GrowthValidationStatus,
    'GrowthValidationStatus',
    'Estado de validación humana',
  ],
  [
    GrowthValidationDecision,
    'GrowthValidationDecision',
    'Decisión al cerrar una validación',
  ],
  [GrowthProspectKind, 'GrowthProspectKind', 'Tipo de registro de Prospect'],
  [GrowthBogotaLocality, 'GrowthBogotaLocality', 'Localidades de Bogotá'],
  [
    GrowthInterestSignal,
    'GrowthInterestSignal',
    'Interés demostrado en EntryLink',
  ],
  [GrowthChannelKind, 'GrowthChannelKind', 'Tipo de canal de contacto'],
  [
    GrowthChannelClass,
    'GrowthChannelClass',
    'Canal profesional o directo de una persona',
  ],
  [
    GrowthLegalBasis,
    'GrowthLegalBasis',
    'Base jurídica de tratamiento (pendiente de validación jurídica)',
  ],
  [
    GrowthContactStatus,
    'GrowthContactStatus',
    'Autorización de contacto comercial',
  ],
  [GrowthPhType, 'GrowthPhType', 'Tipo de propiedad horizontal'],
  [GrowthBuildingKind, 'GrowthBuildingKind', 'Tipo de inmueble'],
  [GrowthInfoStatus, 'GrowthInfoStatus', 'Estado de la información'],
  [GrowthRelationStatus, 'GrowthRelationStatus', 'Vigencia de una relación'],
  [GrowthManagerType, 'GrowthManagerType', 'Quién administra la copropiedad'],
  [
    GrowthEvidenceReliability,
    'GrowthEvidenceReliability',
    'Confiabilidad de la evidencia',
  ],
  [
    GrowthEvidenceStatus,
    'GrowthEvidenceStatus',
    'Estado de verificación de la evidencia',
  ],
];
for (const [e, name, description] of enums) {
  registerEnumType(e, { name, description });
}
