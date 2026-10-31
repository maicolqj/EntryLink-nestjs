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
}
