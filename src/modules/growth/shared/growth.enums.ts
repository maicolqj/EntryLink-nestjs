import { registerEnumType } from '@nestjs/graphql';

/**
 * Enums de la Growth Suite. En la base son `varchar` + CHECK (no enums
 * nativos de Postgres): agregar un valor no obliga a migrar fuera de
 * transacción y quitarlo es posible. Cualquier cambio aquí exige actualizar el
 * CHECK correspondiente en una migración.
 */

export enum GrowthEntityType {
  TEAM_MEMBER = 'TEAM_MEMBER',
  DATA_SOURCE = 'DATA_SOURCE',
  SUPPRESSION = 'SUPPRESSION',
  DATA_SUBJECT_REQUEST = 'DATA_SUBJECT_REQUEST',
  LEGAL_HOLD = 'LEGAL_HOLD',
}

export enum GrowthTeamMemberStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum GrowthSourceKind {
  PUBLIC_REGISTRY = 'PUBLIC_REGISTRY',
  CORPORATE_WEBSITE = 'CORPORATE_WEBSITE',
  PUBLIC_DIRECTORY = 'PUBLIC_DIRECTORY',
  PAID_API = 'PAID_API',
  SUPPLIED_BY_SUBJECT = 'SUPPLIED_BY_SUBJECT',
  MANUAL_RESEARCH = 'MANUAL_RESEARCH',
  SECTOR_SOURCE = 'SECTOR_SOURCE',
  REFERRAL = 'REFERRAL',
}

export enum GrowthSourceStatus {
  ACTIVE = 'ACTIVE',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  DISABLED = 'DISABLED',
}

export enum GrowthLegalReviewStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum GrowthIdentifierType {
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  NIT = 'NIT',
  DOMAIN = 'DOMAIN',
}

export enum GrowthSuppressionScope {
  ALL_CHANNELS = 'ALL_CHANNELS',
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  WHATSAPP = 'WHATSAPP',
}

export enum GrowthSuppressionReason {
  SUBJECT_REQUEST = 'SUBJECT_REQUEST',
  UNSUBSCRIBE = 'UNSUBSCRIBE',
  BOUNCE = 'BOUNCE',
  COMPLAINT = 'COMPLAINT',
  INTERNAL = 'INTERNAL',
}

export enum GrowthSuppressionStatus {
  ACTIVE = 'ACTIVE',
  LIFTED = 'LIFTED',
}

export enum GrowthDataSubjectRequestType {
  ACCESS = 'ACCESS',
  RECTIFICATION = 'RECTIFICATION',
  DELETION = 'DELETION',
  REVOCATION = 'REVOCATION',
  OBJECTION = 'OBJECTION',
}

export enum GrowthRequestChannel {
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  WEB = 'WEB',
  WRITTEN = 'WRITTEN',
}

export enum GrowthDataSubjectRequestStatus {
  RECEIVED = 'RECEIVED',
  IN_PROGRESS = 'IN_PROGRESS',
  EXTENDED = 'EXTENDED',
  RESOLVED = 'RESOLVED',
  REJECTED = 'REJECTED',
}

const register = (e: object, name: string, description: string) =>
  registerEnumType(e, { name, description });

register(GrowthEntityType, 'GrowthEntityType', 'Entidades de la Growth Suite');
register(
  GrowthTeamMemberStatus,
  'GrowthTeamMemberStatus',
  'Estado de un integrante del equipo comercial',
);
register(
  GrowthSourceKind,
  'GrowthSourceKind',
  'Tipo de fuente de información comercial',
);
register(
  GrowthSourceStatus,
  'GrowthSourceStatus',
  'Estado de uso de una fuente',
);
register(
  GrowthLegalReviewStatus,
  'GrowthLegalReviewStatus',
  'Resultado de la revisión jurídica de una fuente',
);
register(
  GrowthIdentifierType,
  'GrowthIdentifierType',
  'Tipo de dato identificador (se guarda solo como hash)',
);
register(
  GrowthSuppressionScope,
  'GrowthSuppressionScope',
  'Canales que bloquea una exclusión',
);
register(
  GrowthSuppressionReason,
  'GrowthSuppressionReason',
  'Motivo de una exclusión',
);
register(
  GrowthSuppressionStatus,
  'GrowthSuppressionStatus',
  'Estado de una exclusión',
);
register(
  GrowthDataSubjectRequestType,
  'GrowthDataSubjectRequestType',
  'Tipo de solicitud del titular (Ley 1581)',
);
register(
  GrowthRequestChannel,
  'GrowthRequestChannel',
  'Canal por el que llegó la solicitud',
);
register(
  GrowthDataSubjectRequestStatus,
  'GrowthDataSubjectRequestStatus',
  'Estado de una solicitud del titular',
);
