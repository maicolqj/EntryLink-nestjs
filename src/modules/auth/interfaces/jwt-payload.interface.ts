import { ValidPermissions } from '../../permissions/enums/valid-permissions';
import { ValidRoles } from '../../roles/enums/valid-roles';

export interface JwtAccessPayload {
  sub: string;
  email: string;
  type: 'access';
  /** 'user' para entidades User, 'complex' para ResidentialComplex */
  entityType: 'user' | 'complex';
  tokenVersion: number;
  sessionId: string;
  roles: ValidRoles[];
  permissions: ValidPermissions[];
  /** Presente para COMPLEX_ROL, SECURITY_ROL y RESIDENT_ROL */
  complexId?: string;
  iat?: number;
  exp?: number;
}

export interface JwtRefreshPayload {
  sub: string;
  type: 'refresh';
  entityType: 'user' | 'complex';
  /**
   * Complejo de la sesión. Presente cuando entityType === 'complex', y también
   * en las sesiones abiertas por un canal de residente, donde el complejo sale
   * de la ficha de residente y no de `users.complex_id`. Permite reconstruir el
   * access token en la rotación sin volver a resolverlo.
   */
  complexId?: string;
  sessionId: string;
  tokenFamily: string;
  deviceFingerprint: string;
  iat?: number;
  exp?: number;
}

export interface DeviceInfo {
  fingerprint: string;
  /**
   * Huella con la fórmula anterior, que incluía el user-agent. Solo para
   * reconocer vínculos guardados antes del cambio; al reconocerlos se
   * reescriben con la nueva y este campo deja de usarse.
   */
  legacyFingerprint?: string;
  userAgent: string;
  ip: string;
  platform: 'ios' | 'android' | 'web';
  deviceId?: string;
  appVersion?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  sessionId: string;
}
