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

  // ── Clave de acceso + dispositivos (residentes) ──────────────────────────
  // Sesión larga para que el residente no vuelva a pasar por el canal pago
  // (WhatsApp). La seguridad la sostienen la clave, el fingerprint y la
  // posibilidad de revocar el dispositivo, no la caducidad del token.
  RESIDENT_DEVICE_REFRESH_EXPIRY: '180d',
  // La clave es UNA por cuenta y sirve en todos los equipos ya vinculados.
  // Alfanumérica de 6: 36^6 ≈ 2.200 millones de combinaciones, contra el millón
  // de un PIN numérico. Se normaliza a mayúsculas porque la diferencia entre
  // "a" y "A" solo produce bloqueos por tipeo, sin aportar seguridad real
  // frente a un atacante limitado a 5 intentos cada 15 minutos.
  ACCESS_CODE_LENGTH: 6,
  ACCESS_CODE_BCRYPT_ROUNDS: 12,
  MAX_DEVICES_PER_RESIDENT: 5,
  MAX_ACCESS_CODE_ATTEMPTS: 5,        // fallos consecutivos → bloqueo temporal
  ACCESS_CODE_LOCK_DURATION: 15 * 60, // 15 minutos en segundos

  // ── Ingreso con documento + clave desde un equipo NO vinculado ───────────
  // Los fallos de este camino NO alimentan el bloqueo de cuenta: el documento
  // no es secreto, así que cualquiera con una lista de cédulas podría dejar sin
  // acceso a todo el conjunto. El freno es por IP y por documento, y solo cierra
  // este camino: los equipos ya vinculados siguen entrando con normalidad.
  UNLINKED_LOGIN_IP_MAX: 15,           // intentos por IP por ventana
  UNLINKED_LOGIN_IDENTITY_MAX: 5,      // fallos por documento por ventana
  UNLINKED_LOGIN_WINDOW: 15 * 60,      // 15 minutos en segundos

  // ── Login por WhatsApp entrante (reverse-OTP) ────────────────────────────
  // Ventana corta: el residente pulsa "enviar" en el momento. Alargarla solo
  // ampliaría el margen para que le hagan enviar un nonce ajeno.
  WA_LOGIN_CHALLENGE_EXPIRY_SECONDS: 2 * 60,
  WA_LOGIN_NONCE_LENGTH: 8,
  WA_LOGIN_RATE_LIMIT_MAX: 3,          // challenges por identidad por ventana
  WA_LOGIN_RATE_LIMIT_WINDOW: 10 * 60, // 10 minutos en segundos

  // ── Aprobación de ingreso por push ───────────────────────────────────────
  // Ventana más amplia que el reverse-OTP: el residente tiene que ver la
  // notificación, abrir la app y comparar el código.
  DEVICE_APPROVAL_EXPIRY_SECONDS: 5 * 60,
  DEVICE_APPROVAL_CODE_LENGTH: 4,
  DEVICE_APPROVAL_RATE_LIMIT_MAX: 3,          // solicitudes por identidad por ventana
  DEVICE_APPROVAL_RATE_LIMIT_WINDOW: 10 * 60, // 10 minutos en segundos

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
    WA_LOGIN_RATE_LIMIT: 'wa-login-rl',
    DEVICE_APPROVAL_RATE_LIMIT: 'dev-appr-rl',
    // Frenos del ingreso desde un equipo sin vincular. Separados del bloqueo de
    // cuenta a propósito: ver UNLINKED_LOGIN_* arriba.
    UNLINKED_LOGIN_IP: 'ul-login-ip',
    UNLINKED_LOGIN_IDENTITY: 'ul-login-id',
    // Permiso temporal para fijar una clave nueva sin conocer la anterior. Lo
    // otorga un ingreso por un canal que ya probó identidad (WhatsApp entrante
    // o aprobación desde otro equipo) y es el camino del "olvidé mi clave".
    ACCESS_CODE_RESET: 'ac-reset',
    OTP_FAILED_ATTEMPTS: 'otp-fa',
    OTP_LOCK: 'otp-lock',
    PASSWORD_RESET_RATE_LIMIT: 'pr-rl',
    EMAIL_VERIFICATION_TOKEN: 'ev-tok',
    // Último token de verificación emitido por usuario. Existe para poder
    // ANULARLO: si el supervisor se equivocó de correo y corrige, el enlace que
    // ya salió a la dirección errónea seguiría siendo válido, y verificar da
    // sesión — se lo estaríamos entregando a un desconocido.
    EMAIL_VERIFICATION_BY_USER: 'ev-user',
    // Enfriamiento del reenvío. Sin él, el botón de la app se convierte en un
    // disparador de correo gratis contra la dirección de un tercero.
    EMAIL_VERIFICATION_RESEND: 'ev-resend',
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
    WA_LOGIN_RATE_LIMIT: 600,       // 10 min
    DEVICE_APPROVAL_RATE_LIMIT: 600, // 10 min
    UNLINKED_LOGIN: 900,             // 15 min (= UNLINKED_LOGIN_WINDOW)
    // Ventana corta: el permiso se usa en la pantalla siguiente al ingreso.
    ACCESS_CODE_RESET: 900,          // 15 min
    PASSWORD_RESET_RATE_LIMIT: 3_600, // 1 hora
    GRACE_WINDOW: 5,           // 5 s (same as GRACE_WINDOW_MS / 1000)
  },

  // ── Reset de contraseña ──────────────────────────────────────────────────
  PASSWORD_RESET_EXPIRY_MINUTES: 60,   // validez del token: 1 hora
  PASSWORD_RESET_RATE_LIMIT_MAX: 3,    // máx. solicitudes por email por hora

  // ── Verificación de email (registro de supervisor) ───────────────────────
  EMAIL_VERIFICATION_EXPIRY_MINUTES: 24,  // 24 horas
  // Espera entre reenvíos. El botón de la app cuenta hacia atrás con este mismo
  // número, pero quien manda es el servidor: el cliente puede reiniciarse.
  EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS: 60,
} as const;

/**
 * Vigencias admitidas para un refresh token.
 *
 * Es una unión de literales a propósito: `jsonwebtoken` tipa `expiresIn` como
 * `StringValue`, así que un `string` genérico no compila. Toda vigencia nueva
 * debe declararse en AUTH_CONSTANTS y sumarse aquí.
 */
export type RefreshExpiry =
  | typeof AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY
  | typeof AUTH_CONSTANTS.REFRESH_TOKEN_EXPIRY_REMEMBER
  | typeof AUTH_CONSTANTS.RESIDENT_DEVICE_REFRESH_EXPIRY;
