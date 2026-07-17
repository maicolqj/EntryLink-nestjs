export const AUTH_CONSTANTS = {
  // ── Tokens ──────────────────────────────────────────────────────────────
  ACCESS_TOKEN_EXPIRY: '15m',
  REFRESH_TOKEN_EXPIRY: '7d',
  REFRESH_TOKEN_EXPIRY_REMEMBER: '30d',

  // ── OTP ─────────────────────────────────────────────────────────────────
  OTP_EXPIRY_SECONDS: 5 * 60,         // 5 minutos
  OTP_LENGTH: 6,
  MAX_OTP_ATTEMPTS: 5,                 // intentos de validación por OTP
  OTP_RATE_LIMIT_MAX: 3,              // máx. solicitudes de OTP por ventana
  OTP_RATE_LIMIT_WINDOW: 10 * 60,    // ventana de rate-limit: 10 minutos (en segundos)
  OTP_BLOCK_DURATION: 30 * 60,       // bloqueo por abuso: 30 minutos (en segundos)

  // ── Reenvío de código de sistema (RES-xxxxx) ─────────────────────────────
  SYSTEM_CODE_RATE_LIMIT_MAX: 3,       // máx. reenvíos por identidad por ventana
  SYSTEM_CODE_RATE_LIMIT_WINDOW: 10 * 60, // ventana: 10 minutos (en segundos)

  // ── Login por email ──────────────────────────────────────────────────────
  MAX_LOGIN_ATTEMPTS: 5,
  LOGIN_BLOCK_DURATION: 15 * 60,     // 15 minutos en segundos
  MAX_IP_ATTEMPTS: 60 /* //?20 */,

  // ── Sesiones ─────────────────────────────────────────────────────────────
  MAX_SESSIONS_PER_USER: 5, 

  // ── Refresh token race-condition grace window ────────────────────────────
  // Concurrent requests arriving with the same RT within this window are served
  // idempotently (same AT+RT returned) instead of being treated as reuse attacks.
  GRACE_WINDOW_MS: 5_000,    // 5 seconds

  // ── Cache prefixes ───────────────────────────────────────────────────────
  CACHE_PREFIX: {
    BLACKLIST: 'bl',
    SESSION: 'sess',
    TOKEN_VERSION: 'tv',
    USER: 'usr',
    FAILED_ATTEMPTS: 'fa',
    ACCOUNT_LOCK: 'al',
    IP_RATE_LIMIT: 'ip-rl',
    OTP_CODE: 'otp',
    OTP_RATE_LIMIT: 'otp-rl',
    SYSTEM_CODE_RATE_LIMIT: 'sc-rl',
    OTP_FAILED_ATTEMPTS: 'otp-fa',
    OTP_LOCK: 'otp-lock',
    PASSWORD_RESET_RATE_LIMIT: 'pr-rl',
    EMAIL_VERIFICATION_TOKEN: 'ev-tok',
    PASSWORD_RESET_TOKEN: 'pr-tok',
    GRACE_WINDOW: 'rt-grace',
  },

  // ── Cache TTL (segundos) ─────────────────────────────────────────────────
  CACHE_TTL: {
    TOKEN_VERSION: 300,        // 5 min
    SESSION: 86_400,           // 24 h
    USER: 3_600,               // 1 h
    FAILED_ATTEMPTS: 900,      // 15 min
    OTP_ATTEMPTS: 1_800,       // 30 min
    OTP_RATE_LIMIT: 600,       // 10 min
    SYSTEM_CODE_RATE_LIMIT: 600, // 10 min
    PASSWORD_RESET_RATE_LIMIT: 3_600, // 1 hora
    GRACE_WINDOW: 5,           // 5 s (same as GRACE_WINDOW_MS / 1000)
  },

  // ── Reset de contraseña ──────────────────────────────────────────────────
  PASSWORD_RESET_EXPIRY_MINUTES: 60,   // validez del token: 1 hora
  PASSWORD_RESET_RATE_LIMIT_MAX: 3,    // máx. solicitudes por email por hora

  // ── Verificación de email (registro de supervisor) ───────────────────────
  EMAIL_VERIFICATION_EXPIRY_MINUTES: 24,  // 24 horas
} as const;
