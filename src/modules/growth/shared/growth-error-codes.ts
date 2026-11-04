/** Códigos de error de la Growth Suite (CustomError.errorCode). */
export enum GrowthErrorCode {
  GROWTH_NOT_FOUND = 'GROWTH_NOT_FOUND',
  /** El usuario ya es integrante del equipo comercial. */
  GROWTH_TEAM_MEMBER_EXISTS = 'GROWTH_TEAM_MEMBER_EXISTS',
  /** El usuario pertenece a un conjunto o no tiene un rol de la suite. */
  GROWTH_TEAM_MEMBER_NOT_ELIGIBLE = 'GROWTH_TEAM_MEMBER_NOT_ELIGIBLE',
  GROWTH_TEAM_MEMBER_INACTIVE = 'GROWTH_TEAM_MEMBER_INACTIVE',
  /** La fuente no cumple las condiciones para quedar activa. */
  GROWTH_SOURCE_NOT_ACTIVATABLE = 'GROWTH_SOURCE_NOT_ACTIVATABLE',
  GROWTH_SOURCE_CODE_TAKEN = 'GROWTH_SOURCE_CODE_TAKEN',
  /** El dato no se pudo normalizar (correo, teléfono, NIT o dominio inválido). */
  GROWTH_INVALID_IDENTIFIER = 'GROWTH_INVALID_IDENTIFIER',
  GROWTH_SUPPRESSION_ALREADY_LIFTED = 'GROWTH_SUPPRESSION_ALREADY_LIFTED',
  GROWTH_INVALID_TRANSITION = 'GROWTH_INVALID_TRANSITION',
  /** La configuración de llaves HMAC falta o es inválida. */
  GROWTH_HMAC_MISCONFIGURED = 'GROWTH_HMAC_MISCONFIGURED',
  GROWTH_LEGAL_HOLD_INVALID = 'GROWTH_LEGAL_HOLD_INVALID',
  // ── EntryLink Prospect (1A) ─────────────────────────────────────────────
  /** La fuente indicada no existe o no está ACTIVE (sin revisión jurídica). */
  GROWTH_SOURCE_NOT_ACTIVE = 'GROWTH_SOURCE_NOT_ACTIVE',
  /** El canal está en la lista de exclusión: no se almacena. */
  GROWTH_CHANNEL_SUPPRESSED = 'GROWTH_CHANNEL_SUPPRESSED',
  GROWTH_DUPLICATE_NIT = 'GROWTH_DUPLICATE_NIT',
  /** Quien registró o capturó no puede validar (separación de funciones). */
  GROWTH_SELF_VALIDATION_FORBIDDEN = 'GROWTH_SELF_VALIDATION_FORBIDDEN',
  /** Faltan requisitos de la lista de validación. */
  GROWTH_VALIDATION_INCOMPLETE = 'GROWTH_VALIDATION_INCOMPLETE',
  /** La base jurídica está pendiente: no se puede autorizar contacto. */
  GROWTH_LEGAL_BASIS_PENDING = 'GROWTH_LEGAL_BASIS_PENDING',
  GROWTH_INVALID_INPUT = 'GROWTH_INVALID_INPUT',
  // ── Importaciones (1C) ──────────────────────────────────────────────────
  /** El archivo no se pudo leer o supera los límites (tamaño, filas, columnas). */
  GROWTH_IMPORT_FILE_INVALID = 'GROWTH_IMPORT_FILE_INVALID',
  /** El mapeo de columnas no es válido para el destino. */
  GROWTH_IMPORT_MAPPING_INVALID = 'GROWTH_IMPORT_MAPPING_INVALID',
  /** La operación no aplica al estado actual del lote. */
  GROWTH_IMPORT_INVALID_STATE = 'GROWTH_IMPORT_INVALID_STATE',
  /** El archivo y las filas crudas ya se purgaron (30 días). */
  GROWTH_IMPORT_PURGED = 'GROWTH_IMPORT_PURGED',
  /** Las reglas y umbrales se cambian en un borrador que se aprueba. */
  GROWTH_SCORING_REQUIRES_APPROVAL = 'GROWTH_SCORING_REQUIRES_APPROVAL',
  /** La operación no aplica al estado de la versión de scoring. */
  GROWTH_SCORING_VERSION_STATE = 'GROWTH_SCORING_VERSION_STATE',
  /** Quien propuso o editó un borrador no lo aprueba (salvo la excepción auditada). */
  GROWTH_SCORING_SELF_APPROVAL_FORBIDDEN = 'GROWTH_SCORING_SELF_APPROVAL_FORBIDDEN',
  /** Falta el permiso de configurar o aprobar el scoring. */
  GROWTH_SCORING_FORBIDDEN = 'GROWTH_SCORING_FORBIDDEN',
}
