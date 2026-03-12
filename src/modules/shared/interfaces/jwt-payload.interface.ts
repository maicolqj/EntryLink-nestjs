import { ValidPermissions } from "../../permissions/enums/valid-permissions";
import { ValidRoles } from "../../roles/enums/valid-roles";

export interface JwtAccessPayload {
  sub: string;
  email: string;
  type: 'access';
  tokenVersion: number;
  sessionId: string;
  roles: ValidRoles[];
  permissions: ValidPermissions[];
  complexId?: string;
  iat?: number;
  exp?: number;
}

export interface JwtRefreshPayload {
  sub: string;
  type: 'refresh';
  sessionId: string;
  tokenFamily: string;
  deviceFingerprint: string;
  iat?: number;
  exp?: number;
}

export interface DeviceInfo {
  fingerprint: string;
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