
export interface AccountLockData {
  attempts: number;
  blockedUntil: string;
  email: string;
  lockedAt: string;
}

export interface LoginAttemptData {
  count: number;
  lastAttemptAt: string;
  blockedUntil?: string;
}

export interface CachedUserData {
  id: string;
  email: string;
  name: string;
  lastName?: string;
  phoneNumber?: string;
  profilePicture?: string;
  status: string;
  phoneVerified: boolean;
  emailVerified: boolean;
  tokenVersion: number;
}

export interface OtpLockData {
  attempts: number;
  blockedUntil: string;
  phoneNumber: string;
  lockedAt: string;
}

export interface VerifyOtpResult {
  success: boolean;
  message: string;
  userExists: boolean;
  user?: any;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  sessionId?: string;
  verifiedPhone?: string;
}
